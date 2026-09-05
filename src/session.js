import { ValidationError } from "./errors.js";
import {
  applyTemporalEffect,
  assertCooldownAvailability,
  finishOpportunityConsumption,
  finishRelationalConsumption,
  injectRelationalModifiers,
  installCooldowns,
  processTemporalEnd,
  processTemporalStart,
  triggerOpportunities,
  validateTemporalReferences
} from "./temporal.js";
import {
  beginStrategyStep,
  completeStrategyStep,
  strategyDiagnostics,
  strategyEffects,
  validateStrategyDag
} from "./strategy.js";
import { canonicalHash, deepClone, deepFreeze, stableStringify } from "./utils.js";

function validateSessionSnapshot(engine, snapshot) {
  engine.schemas.validate("world", snapshot.world);
  for (const character of Object.values(snapshot.characters)) engine.schemas.validate("character", character);
  engine.schemas.validate("temporalState", snapshot.temporal_state);
  validateTemporalReferences(snapshot.temporal_state, snapshot.characters, snapshot.world);
  const ids = new Set();
  for (const strategy of snapshot.strategies) {
    engine.schemas.validate("strategyDag", strategy);
    if (ids.has(strategy.strategy_id)) throw new ValidationError(`Duplicate strategy id: ${strategy.strategy_id}`);
    ids.add(strategy.strategy_id);
    validateStrategyDag(strategy, snapshot.characters, engine.config);
  }
}

function preparedStrategyActions(bindings, turn) {
  return bindings.map((binding) => ({ ...deepClone(binding.action), turn }));
}

function augmentedPreviousTurn(world, temporalEvents, strategyTransitions) {
  world.previous_turn.temporal_events = deepClone(temporalEvents);
  world.previous_turn.strategy_changes = deepClone(strategyTransitions);
}

function mechanicResult(result) {
  return {
    outcome: result.outcome,
    nextSnapshot: result.nextSnapshot,
    turnResultHash: result.turnResult?.resultHash ?? null,
    temporalEvents: result.temporalEvents,
    strategyProgress: result.strategyProgress,
    sessionMetadata: result.sessionMetadata
  };
}

export function resolveSessionStep(engine, input) {
  engine.schemas.validate("session", input);
  validateSessionSnapshot(engine, input.snapshot);
  if (input.snapshot.temporal_state.session.status !== "ACTIVE") {
    const unchanged = deepClone(input.snapshot);
    return deepFreeze({
      outcome: "inactive",
      reason: `session_${input.snapshot.temporal_state.session.status.toLowerCase()}`,
      nextSnapshot: unchanged,
      turnResult: null,
      temporalEvents: [],
      strategyProgress: { results: [], transitions: [] },
      sessionMetadata: deepClone(input.snapshot.temporal_state.session),
      replayData: { inputHash: canonicalHash(input), resultHash: canonicalHash(unchanged) },
      resultHash: canonicalHash(unchanged),
      trace: input.trace === false ? undefined : { pipeline: ["session_inactive"], startingSnapshotHash: canonicalHash(unchanged), resultingSnapshotHash: canonicalHash(unchanged) }
    });
  }
  const originalHash = canonicalHash(input.snapshot);
  const declarations = deepClone(input.declarations);
  const started = processTemporalStart(input.snapshot, declarations, engine.config);
  const working = started.snapshot;
  working.strategies.sort((left, right) => left.strategy_id.localeCompare(right.strategy_id));
  for (const strategy of working.strategies) strategy.nodes.sort((left, right) => left.id.localeCompare(right.id));
  const temporalEvents = [...started.events];
  const strategyStart = beginStrategyStep(engine.config, { ...working, declarations, seed: String(input.seed) }, working.strategies);
  const strategyActions = preparedStrategyActions(strategyStart.actionBindings, working.world.turn);
  const directActions = deepClone(declarations.actions);
  const combinedDeclarations = { actions: [...directActions, ...strategyActions], reactions: deepClone(declarations.reactions) };
  const opportunity = triggerOpportunities(working, combinedDeclarations, temporalEvents);
  temporalEvents.push(...opportunity.events);
  const relationInjection = injectRelationalModifiers(working, combinedDeclarations.actions);
  assertCooldownAvailability(working.characters, relationInjection.actions);
  working.temporal_state.phase = "ACTION_RESOLUTION";
  const turnInput = {
    id: `${input.id}:turn:${working.world.turn}`,
    world: working.world,
    characters: working.characters,
    actions: relationInjection.actions,
    reactions: [...combinedDeclarations.reactions, ...opportunity.generatedReactions],
    registries: input.registries,
    seed: `${String(input.seed)}:turn:${working.world.turn}`,
    trace: input.trace !== false
  };
  const turnResult = engine.resolveTurn(turnInput);
  if (turnResult.outcome !== "committed") {
    const unchanged = deepClone(input.snapshot);
    const aborted = {
      outcome: "aborted",
      reason: turnResult.reason,
      nextSnapshot: unchanged,
      turnResult,
      temporalEvents: [],
      strategyProgress: { eligibility: strategyStart.eligibility, results: [], transitions: [] },
      sessionMetadata: deepClone(input.snapshot.temporal_state.session)
    };
    const resultHash = canonicalHash(mechanicResult(aborted));
    return deepFreeze({
      ...aborted,
      replayData: { inputHash: canonicalHash(input), configurationHash: canonicalHash({ version: engine.config.version, specs: engine.config.specs, schemas: engine.config.schemas }), resultHash },
      resultHash,
      trace: input.trace === false ? undefined : { startingSnapshotHash: originalHash, temporalStart: started.events, strategyEligibility: strategyStart.eligibility, combatResolution: turnResult.trace, pipeline: ["temporal_start", "strategy_eligibility", "combat_aborted", "session_rollback"] }
    });
  }

  const nextSnapshot = {
    world: deepClone(turnResult.world),
    characters: deepClone(turnResult.characters),
    temporal_state: deepClone(working.temporal_state),
    strategies: deepClone(working.strategies)
  };
  const relationConsumed = finishRelationalConsumption(nextSnapshot.temporal_state, relationInjection.applied, turnResult.actionResults);
  temporalEvents.push(...relationConsumed.map((item) => ({ type: "relation_consumed", relation_id: item.relationId, semantics: item.semantics, result_ref: item.resultRef })));
  const opportunityConsumed = finishOpportunityConsumption(nextSnapshot.temporal_state, opportunity.reactionBindings, turnResult.reactionResults);
  temporalEvents.push(...opportunityConsumed.map((item) => ({ type: "opportunity_consumed", opportunity_id: item.opportunityId, semantics: item.semantics, result_ref: item.resultRef })));
  temporalEvents.push(...installCooldowns(nextSnapshot.characters, relationInjection.actions, turnResult.actionResults, input.snapshot.world.turn));
  const strategyProgress = completeStrategyStep(nextSnapshot.strategies, strategyStart, turnResult.actionResults);
  const effects = strategyEffects(nextSnapshot.strategies, strategyProgress.results);
  for (const item of effects) temporalEvents.push(...applyTemporalEffect(nextSnapshot, item.effect, { declarations: { actions: relationInjection.actions, reactions: turnInput.reactions } }, `${item.strategyId}:${item.nodeId}`));
  const combatEvents = turnResult.events.map((event) => ({ ...deepClone(event), type: event.type, source: "combat" }));
  temporalEvents.push(...combatEvents);
  nextSnapshot.temporal_state.phase = "POST_ACTION";
  const temporalEndEvents = processTemporalEnd(
    nextSnapshot,
    input.snapshot,
    { actions: relationInjection.actions, reactions: turnInput.reactions },
    temporalEvents,
    engine.config,
    input.termination_predicates ?? []
  );
  temporalEvents.push(...temporalEndEvents);
  augmentedPreviousTurn(nextSnapshot.world, temporalEvents, strategyProgress.transitions);
  nextSnapshot.world.previous_turn.resulting_snapshot_hash = canonicalHash({ world: nextSnapshot.world, characters: nextSnapshot.characters, temporal_state: nextSnapshot.temporal_state, strategies: nextSnapshot.strategies });
  validateSessionSnapshot(engine, nextSnapshot);
  const sessionMetadata = {
    ...deepClone(nextSnapshot.temporal_state.session),
    startingTurn: input.snapshot.world.turn,
    resultingTurn: nextSnapshot.world.turn,
    delegatedResolver: "resolveTurn"
  };
  const diagnostics = strategyDiagnostics(nextSnapshot.strategies, strategyProgress.results, strategyProgress.transitions, temporalEvents);
  const trace = {
    specVersion: engine.config.version,
    seed: String(input.seed),
    startingSnapshotHash: originalHash,
    temporalStart: started.events,
    opportunityTriggers: opportunity.events,
    strategyEligibility: strategyStart.eligibility,
    nodeExecution: strategyProgress.results,
    combatResolution: turnResult.trace,
    stateConsequences: effects,
    relationalModifierApplications: relationInjection.applied,
    strategyTransitions: strategyProgress.transitions,
    temporalEnd: temporalEndEvents,
    resultingSnapshotHash: canonicalHash(nextSnapshot),
    pipeline: engine.config.specs["temporal.yaml"].phases.order
  };
  const base = {
    outcome: "committed",
    nextSnapshot,
    turnResult,
    temporalEvents,
    strategyProgress: { ...strategyProgress, eligibility: strategyStart.eligibility, diagnostics },
    sessionMetadata
  };
  const resultHash = canonicalHash(mechanicResult(base));
  const replayData = {
    inputHash: canonicalHash(input),
    configurationHash: canonicalHash({ version: engine.config.version, specs: engine.config.specs, schemas: engine.config.schemas }),
    turnResultHash: turnResult.resultHash,
    traceHash: canonicalHash(trace),
    resultHash
  };
  return deepFreeze({ ...base, replayData, resultHash, trace: input.trace === false ? undefined : trace });
}

export function resolveSession(engine, input) {
  if (!input || !input.initial_snapshot || !Array.isArray(input.steps)) throw new ValidationError("Session sequence requires initial_snapshot and steps.");
  let snapshot = deepClone(input.initial_snapshot);
  const stepResults = [];
  const snapshots = [deepFreeze(deepClone(snapshot))];
  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index];
    const result = resolveSessionStep(engine, {
      id: `${input.id}:step:${index}`,
      snapshot,
      declarations: step.declarations,
      registries: input.registries,
      termination_predicates: input.termination_predicates ?? [],
      seed: step.seed ?? `${String(input.seed)}:${index}`,
      trace: input.trace !== false
    });
    stepResults.push(result);
    snapshot = deepClone(result.nextSnapshot);
    snapshots.push(deepFreeze(deepClone(snapshot)));
    if (result.outcome !== "committed" || snapshot.temporal_state.session.status !== "ACTIVE") break;
  }
  const mechanical = {
    outcome: stepResults.every((result) => result.outcome === "committed") ? "completed_steps" : stepResults.at(-1)?.outcome ?? "empty",
    finalSnapshot: snapshot,
    stepResultHashes: stepResults.map((result) => result.resultHash)
  };
  const resultHash = canonicalHash(mechanical);
  return deepFreeze({
    ...mechanical,
    snapshots,
    stepResults,
    replayData: { inputHash: canonicalHash(input), resultHash },
    resultHash,
    trace: input.trace === false ? undefined : { sessionId: input.id, steps: stepResults.map((result) => result.trace), finalSnapshotHash: canonicalHash(snapshot) }
  });
}

export function replaySession(engine, input, expected = null) {
  const first = resolveSession(engine, { ...deepClone(input), trace: true });
  const second = resolveSession(engine, { ...deepClone(input), trace: true });
  const canonical = stableStringify(first);
  return deepFreeze({
    deterministic: canonical === stableStringify(second),
    matchesExpected: expected ? canonical === stableStringify(expected) : null,
    actualHash: canonicalHash(first),
    expectedHash: expected ? canonicalHash(expected) : null,
    result: first
  });
}
