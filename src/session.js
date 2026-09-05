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
  normalizeStrategyDag,
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

function normalizeWorkingStrategies(strategies, config) {
  for (const strategy of strategies) normalizeStrategyDag(strategy, config);
}

function preparedStrategyActions(bindings, turn) {
  return bindings.map((binding) => {
    const action = { ...deepClone(binding.action), turn };
    if (binding.executionClass !== "ACTION") action.economy_class = binding.executionClass;
    return action;
  });
}

function consumeImmediateEconomy(characters, consumptions) {
  for (const item of consumptions) {
    const character = characters[item.actorId];
    if (item.executionClass === "REACTION") {
      const before = character.action_economy.reactions_remaining ?? (character.action_economy.reaction_available ? 1 : 0);
      if (before < item.amount) throw new ValidationError(`Character ${item.actorId} lacks reaction capacity.`);
      character.action_economy.reactions_remaining = before - item.amount;
      character.action_economy.reaction_available = character.action_economy.reactions_remaining > 0;
    } else if (item.executionClass === "MOVEMENT" && Number.isInteger(character.movement_economy)) {
      if (character.movement_economy < item.amount) throw new ValidationError(`Character ${item.actorId} lacks movement capacity.`);
      character.movement_economy -= item.amount;
    } else if (item.executionClass === "ACTION" || item.executionClass === "MOVEMENT") {
      const before = character.action_economy.actions_remaining ?? (character.action_economy.available ? 1 : 0);
      if (before < item.amount) throw new ValidationError(`Character ${item.actorId} lacks action capacity.`);
      character.action_economy.actions_remaining = before - item.amount;
      character.action_economy.available = character.action_economy.actions_remaining > 0;
    }
  }
}

function aggregateChanges(waves, field) {
  return waves.flatMap((wave) => wave.trace?.merge?.[field] ?? []);
}

function finalizeSessionTurn(working, input, originalHash, waves, actionResults, reactionResults, combatEvents) {
  const startingTurn = working.world.turn;
  working.world.turn += 1;
  working.world.time.elapsed_seconds += working.world.time.turn_duration_seconds;
  const resourceChanges = aggregateChanges(waves, "resourceChanges");
  const economyChanges = aggregateChanges(waves, "actionEconomyChanges");
  const statusChanges = aggregateChanges(waves, "statusChanges");
  const displacementChanges = aggregateChanges(waves, "displacementChanges");
  working.world.previous_turn = {
    turn: startingTurn,
    snapshot_hash: originalHash,
    action_refs: actionResults.map((result) => result.id),
    events: combatEvents.map((event, sequence) => ({
      sequence,
      type: event.type,
      actor_refs: deepClone(event.actor_refs),
      target_refs: deepClone(event.target_refs),
      action_ref: event.action_ref,
      payload: deepClone(event.payload)
    })),
    resource_deltas: resourceChanges.map((change) => ({ character_id: change.characterId, resource: change.resource, delta: change.delta })),
    created_modifier_ids: [],
    expired_modifier_ids: [],
    status_changes: statusChanges,
    action_economy_changes: economyChanges,
    displacement_changes: displacementChanges,
    conflicts: waves.flatMap((wave) => wave.conflicts ?? []),
    resulting_snapshot_hash: null,
    summary_tags: [...new Set(["combat_turn", ...actionResults.map((result) => result.outcome)])].sort()
  };
  return {
    outcome: "committed",
    world: deepClone(working.world),
    characters: deepClone(working.characters),
    actionResults: deepClone(actionResults),
    reactionResults: deepClone(reactionResults),
    events: deepClone(combatEvents),
    conflicts: deepClone(working.world.previous_turn.conflicts),
    resultHash: canonicalHash({ world: working.world, characters: working.characters, actionResults, reactionResults, events: combatEvents, conflicts: working.world.previous_turn.conflicts }),
    trace: { waves: waves.map((wave) => wave.trace), startingSnapshotHash: originalHash, resultingSnapshotHash: canonicalHash({ world: working.world, characters: working.characters }) }
  };
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
  // Strategy declaration order is not a mechanical input. Canonicalize the
  // immutable starting snapshot before temporal hooks record its hash so that
  // equivalent simultaneous strategies remain order-independent.
  const normalizedStartingSnapshot = deepClone(input.snapshot);
  normalizedStartingSnapshot.strategies.sort((left, right) => left.strategy_id.localeCompare(right.strategy_id));
  for (const strategy of normalizedStartingSnapshot.strategies) strategy.nodes.sort((left, right) => left.id.localeCompare(right.id));
  normalizeWorkingStrategies(normalizedStartingSnapshot.strategies, engine.config);
  const originalHash = canonicalHash(normalizedStartingSnapshot);
  const declarations = deepClone(input.declarations);
  const started = processTemporalStart(normalizedStartingSnapshot, declarations, engine.config);
  const working = started.snapshot;
  working.strategies.sort((left, right) => left.strategy_id.localeCompare(right.strategy_id));
  for (const strategy of working.strategies) strategy.nodes.sort((left, right) => left.id.localeCompare(right.id));
  normalizeWorkingStrategies(working.strategies, engine.config);
  const temporalEvents = [...started.events];
  const waves = [];
  const allEligibility = [];
  const allResults = [];
  const allTransitions = [];
  const allEffects = [];
  const allRelationApplications = [];
  const allOpportunityEvents = [];
  const allActions = [];
  const allReactions = [];
  const actionResults = [];
  const reactionResults = [];
  const combatEvents = [];
  const potentialActionIds = new Set([
    ...declarations.actions.map((action) => action.id),
    ...working.strategies.flatMap((strategy) => strategy.nodes.map((node) => node.action?.id).filter(Boolean))
  ]);
  for (const reaction of declarations.reactions) if (!potentialActionIds.has(reaction.target_action_id)) throw new ValidationError(`Reaction ${reaction.id} targets unknown session action ${reaction.target_action_id}.`);
  const maximumWaves = working.strategies.reduce((sum, strategy) => sum + strategy.nodes.length, 0) + 2;
  let directActions = deepClone(declarations.actions);
  for (let waveIndex = 0; waveIndex < maximumWaves; waveIndex += 1) {
    const schedulerDeclarations = { actions: directActions, reactions: declarations.reactions };
    const strategyStart = beginStrategyStep(engine.config, { ...working, declarations: schedulerDeclarations, seed: `${String(input.seed)}:strategy:${waveIndex}` }, working.strategies);
    allEligibility.push(...strategyStart.eligibility);
    consumeImmediateEconomy(working.characters, strategyStart.economyConsumptions ?? []);
    const strategyActions = preparedStrategyActions(strategyStart.actionBindings, working.world.turn);
    const waveActions = [...directActions, ...strategyActions];
    directActions = [];
    let waveActionResults = [];
    let waveReactionResults = [];
    let waveTurnResult = null;
    let appliedRelations = [];
    let opportunity = { events: [], generatedReactions: [], reactionBindings: [] };
    let turnReactions = [];
    let resolvedActions = waveActions;
    if (waveActions.length) {
      opportunity = triggerOpportunities(working, { actions: waveActions, reactions: declarations.reactions }, temporalEvents);
      allOpportunityEvents.push(...opportunity.events);
      temporalEvents.push(...opportunity.events);
      const relationInjection = injectRelationalModifiers(working, waveActions);
      appliedRelations = relationInjection.applied;
      allRelationApplications.push(...appliedRelations);
      resolvedActions = relationInjection.actions;
      assertCooldownAvailability(working.characters, resolvedActions);
      const actionIds = new Set(resolvedActions.map((action) => action.id));
      turnReactions = [...declarations.reactions.filter((reaction) => actionIds.has(reaction.target_action_id)), ...opportunity.generatedReactions];
      working.temporal_state.phase = "ACTION_RESOLUTION";
      waveTurnResult = engine.resolveTurn({
        id: `${input.id}:turn:${working.world.turn}:wave:${waveIndex}`,
        world: working.world,
        characters: working.characters,
        actions: resolvedActions,
        reactions: turnReactions,
        registries: input.registries,
        seed: `${String(input.seed)}:turn:${working.world.turn}:wave:${waveIndex}`,
        trace: true,
        advance_time: false
      });
      if (waveTurnResult.outcome !== "committed") {
        const unchanged = deepClone(input.snapshot);
        const aborted = { outcome: "aborted", reason: waveTurnResult.reason, nextSnapshot: unchanged, turnResult: waveTurnResult, temporalEvents: [], strategyProgress: { eligibility: allEligibility, results: [], transitions: [] }, sessionMetadata: deepClone(input.snapshot.temporal_state.session) };
        const resultHash = canonicalHash(mechanicResult(aborted));
        return deepFreeze({ ...aborted, replayData: { inputHash: canonicalHash(input), configurationHash: canonicalHash({ version: engine.config.version, specs: engine.config.specs, schemas: engine.config.schemas }), resultHash }, resultHash, trace: input.trace === false ? undefined : { startingSnapshotHash: originalHash, temporalStart: started.events, strategyEligibility: allEligibility, combatResolution: waveTurnResult.trace, pipeline: ["temporal_start", "strategy_eligibility", "combat_aborted", "session_rollback"] } });
      }
      working.world = deepClone(waveTurnResult.world);
      working.characters = deepClone(waveTurnResult.characters);
      waveActionResults = waveTurnResult.actionResults;
      waveReactionResults = waveTurnResult.reactionResults;
      waves.push(waveTurnResult);
      actionResults.push(...waveActionResults);
      reactionResults.push(...waveReactionResults);
      allActions.push(...resolvedActions);
      allReactions.push(...turnReactions);
      const relationConsumed = finishRelationalConsumption(working.temporal_state, appliedRelations, waveActionResults);
      temporalEvents.push(...relationConsumed.map((item) => ({ type: "relation_consumed", relation_id: item.relationId, semantics: item.semantics, result_ref: item.resultRef })));
      const opportunityConsumed = finishOpportunityConsumption(working.temporal_state, opportunity.reactionBindings, waveReactionResults);
      temporalEvents.push(...opportunityConsumed.map((item) => ({ type: "opportunity_consumed", opportunity_id: item.opportunityId, semantics: item.semantics, result_ref: item.resultRef })));
      temporalEvents.push(...installCooldowns(working.characters, resolvedActions, waveActionResults, input.snapshot.world.turn));
      const waveCombatEvents = waveTurnResult.events.map((event) => ({ ...deepClone(event), type: event.type, source: "combat" }));
      combatEvents.push(...waveCombatEvents);
      temporalEvents.push(...waveCombatEvents);
    }
    const progress = completeStrategyStep(working.strategies, strategyStart, waveActionResults, { ...working, declarations: { actions: resolvedActions, reactions: turnReactions }, events: temporalEvents });
    allResults.push(...progress.results);
    allTransitions.push(...progress.transitions);
    const effects = strategyEffects(working.strategies, progress.results);
    allEffects.push(...effects);
    for (const item of effects) temporalEvents.push(...applyTemporalEffect(working, item.effect, { declarations: { actions: resolvedActions, reactions: turnReactions }, events: temporalEvents, creation_turn: input.snapshot.world.turn + 1 }, `${item.strategyId}:${item.nodeId}`));
    const progressed = strategyStart.immediateResults.length > 0 || strategyStart.actionBindings.length > 0 || waveActions.length > 0;
    if (!progressed) break;
    if (waveIndex === maximumWaves - 1) throw new ValidationError(`Strategy scheduler exceeded ${maximumWaves} economy waves in one session step.`);
  }
  const turnResult = finalizeSessionTurn(working, input, originalHash, waves, actionResults, reactionResults, combatEvents);
  const nextSnapshot = { world: deepClone(turnResult.world), characters: deepClone(turnResult.characters), temporal_state: deepClone(working.temporal_state), strategies: deepClone(working.strategies) };
  const strategyProgress = { results: allResults, transitions: allTransitions, strategies: working.strategies.map((strategy) => ({ strategyId: strategy.strategy_id, executionState: strategy.state, goals: { required: (strategy.goals?.required ?? []).map((id) => ({ node_id: id, state: strategy.nodes.find((node) => node.id === id)?.state })), optional: (strategy.goals?.optional ?? []).map((id) => ({ node_id: id, state: strategy.nodes.find((node) => node.id === id)?.state })) } })) };
  nextSnapshot.temporal_state.phase = "POST_ACTION";
  const temporalEndEvents = processTemporalEnd(
    nextSnapshot,
    input.snapshot,
    { actions: allActions, reactions: allReactions },
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
    opportunityTriggers: allOpportunityEvents,
    strategyEligibility: allEligibility,
    nodeExecution: strategyProgress.results,
    combatResolution: turnResult.trace,
    stateConsequences: allEffects,
    relationalModifierApplications: allRelationApplications,
    strategyTransitions: strategyProgress.transitions,
    temporalEnd: temporalEndEvents,
    resultingSnapshotHash: canonicalHash(nextSnapshot),
    pipeline: engine.config.specs["temporal.yaml"].phases.order
  };
  const base = {
    outcome: "committed",
    nextSnapshot,
    turnResult: input.trace === false ? { ...turnResult, trace: undefined } : turnResult,
    temporalEvents,
    strategyProgress: { ...strategyProgress, eligibility: allEligibility, diagnostics },
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
