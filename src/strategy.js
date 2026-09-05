import { coefficient } from "./config.js";
import { ValidationError } from "./errors.js";
import { microVariance } from "./variance.js";
import { deepClone, roundTo, weightedMean } from "./utils.js";
import { cooldownAvailable, evaluateTemporalPredicate } from "./temporal.js";
import { actionCostPlan } from "./turn.js";

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED", "BLOCKED", "EXPIRED"]);

function nodeMap(strategy) {
  return new Map(strategy.nodes.map((node) => [node.id, node]));
}

export function validateStrategyDag(strategy, characters, config) {
  const map = nodeMap(strategy);
  if (map.size !== strategy.nodes.length) throw new ValidationError(`Strategy ${strategy.strategy_id} has duplicate node ids.`);
  if (!characters[strategy.owner]) throw new ValidationError(`Strategy ${strategy.strategy_id} has unknown owner ${strategy.owner}.`);
  const allowed = new Set(Object.keys(config.specs["strategy.yaml"].primitive_resolution.opposed_contests)
    .concat(Object.keys(config.specs["strategy.yaml"].primitive_resolution.action_backed))
    .concat(Object.keys(config.specs["strategy.yaml"].primitive_resolution.condition_backed))
    .concat(Object.keys(config.specs["strategy.yaml"].primitive_resolution.state_setup)));
  for (const node of strategy.nodes) {
    if (node.kind === "ACTION" && !node.action) throw new ValidationError(`Strategy action node ${node.id} requires a normalized action.`);
    if (node.kind === "PRIMITIVE" && !node.primitive) throw new ValidationError(`Strategy primitive node ${node.id} requires a normalized primitive.`);
    if (node.kind === "CONDITION" && !node.condition) throw new ValidationError(`Strategy condition node ${node.id} requires a predicate.`);
    for (const dependency of node.dependencies) if (!map.has(dependency.node_id)) throw new ValidationError(`Strategy node ${node.id} depends on unknown node ${dependency.node_id}.`);
    for (const fallbackId of node.fallback_node_ids) if (!map.has(fallbackId)) throw new ValidationError(`Strategy node ${node.id} references unknown fallback ${fallbackId}.`);
    if (node.kind === "ACTION" && node.action.actor_id !== strategy.owner) throw new ValidationError(`Strategy action node ${node.id} actor must match owner ${strategy.owner}.`);
    if (node.action) {
      for (const target of node.action.targets.filter((candidate) => candidate.type === "character")) {
        if (!characters[target.ref]) throw new ValidationError(`Strategy action node ${node.id} has unknown target ${target.ref}.`);
      }
    }
    if (node.kind === "PRIMITIVE") {
      if (!allowed.has(node.primitive.id)) throw new ValidationError(`Unknown strategic primitive ${node.primitive.id}.`);
      if (node.primitive.actor_ref !== strategy.owner) throw new ValidationError(`Primitive node ${node.id} actor must match owner ${strategy.owner}.`);
      if (node.primitive.target_ref && !characters[node.primitive.target_ref]) throw new ValidationError(`Primitive node ${node.id} has unknown target ${node.primitive.target_ref}.`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new ValidationError(`Strategy ${strategy.strategy_id} contains a cycle at node ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of map.get(id).dependencies) visit(dependency.node_id);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of [...map.keys()].sort()) visit(id);
  return true;
}

function actionAvailability(action, context) {
  if (!action) return { available: true, reason: "not_action_backed" };
  const character = context.characters[action.actor_id];
  const economy = character.action_economy;
  if ((economy.actions_remaining ?? (economy.available ? 1 : 0)) <= 0) return { available: false, reason: "action_capacity_unavailable" };
  const cooldownKey = action.cooldown?.key ?? action.id;
  if (!cooldownAvailable(character, cooldownKey)) return { available: false, reason: "cooldown_unavailable" };
  const required = new Map();
  for (const cost of actionCostPlan(action)) required.set(cost.resource, (required.get(cost.resource) ?? 0) + cost.maximumAmount);
  for (const [resource, amount] of [...required].sort(([left], [right]) => left.localeCompare(right))) {
    if ((character.resources[resource]?.current ?? -Infinity) < amount) return { available: false, reason: `resource_unavailable:${resource}` };
  }
  return { available: true, reason: "available" };
}

function reserveVirtualAction(action, characters) {
  const character = characters[action.actor_id];
  if (!character) return;
  character.action_economy.actions_remaining = (character.action_economy.actions_remaining ?? (character.action_economy.available ? 1 : 0)) - 1;
  for (const cost of actionCostPlan(action)) {
    if (character.resources[cost.resource]) character.resources[cost.resource].current -= cost.maximumAmount;
  }
}

function dependencyMatches(dependency, predecessor) {
  if (dependency.when === "ON_SUCCESS") return predecessor.state === "SUCCEEDED";
  if (dependency.when === "ON_FAILURE") return predecessor.state === "FAILED";
  return TERMINAL.has(predecessor.state);
}

function dependencyEligibility(node, map) {
  if (!node.dependencies.length) return { eligible: true, impossible: false, evaluations: [] };
  const evaluations = node.dependencies.map((dependency) => {
    const predecessor = map.get(dependency.node_id);
    return { ...dependency, predecessorState: predecessor.state, satisfied: dependencyMatches(dependency, predecessor), terminal: TERMINAL.has(predecessor.state) };
  });
  if (node.dependency_mode === "ALL_OF") {
    return {
      eligible: evaluations.every((item) => item.satisfied),
      impossible: evaluations.some((item) => item.terminal && !item.satisfied),
      evaluations
    };
  }
  return {
    eligible: evaluations.some((item) => item.satisfied),
    impossible: evaluations.every((item) => item.terminal) && !evaluations.some((item) => item.satisfied),
    evaluations
  };
}

export function scheduleStrategyNodes(strategies, context) {
  const records = [];
  const executable = [];
  const availabilityCharacters = deepClone(context.characters);
  for (const action of [...(context.declarations?.actions ?? [])].sort((left, right) => left.id.localeCompare(right.id))) reserveVirtualAction(action, availabilityCharacters);
  for (const strategy of [...strategies].sort((a, b) => a.strategy_id.localeCompare(b.strategy_id))) {
    if (strategy.state !== "ACTIVE") continue;
    const map = nodeMap(strategy);
    for (const node of [...strategy.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      if (TERMINAL.has(node.state) || ["RESERVED", "RESOLVING"].includes(node.state)) {
        records.push({ strategyId: strategy.strategy_id, nodeId: node.id, eligible: false, reason: "terminal_or_active", state: node.state, dependencies: [] });
        continue;
      }
      const dependencies = dependencyEligibility(node, map);
      if (dependencies.impossible) {
        node.state = "BLOCKED";
        records.push({ strategyId: strategy.strategy_id, nodeId: node.id, eligible: false, reason: "dependency_branch_unavailable", state: node.state, dependencies: dependencies.evaluations });
        continue;
      }
      if (!dependencies.eligible) {
        node.state = "PENDING";
        records.push({ strategyId: strategy.strategy_id, nodeId: node.id, eligible: false, reason: "dependencies_pending", state: node.state, dependencies: dependencies.evaluations });
        continue;
      }
      const conditions = node.conditions.map((predicate, index) => ({ index, result: evaluateTemporalPredicate(predicate, context) }));
      if (!conditions.every((item) => item.result)) {
        node.state = "PENDING";
        records.push({ strategyId: strategy.strategy_id, nodeId: node.id, eligible: false, reason: "conditions_false", state: node.state, dependencies: dependencies.evaluations, conditions });
        continue;
      }
      const availability = actionAvailability(node.action, { ...context, characters: availabilityCharacters });
      if (!availability.available) {
        node.state = "PENDING";
        records.push({ strategyId: strategy.strategy_id, nodeId: node.id, eligible: false, reason: availability.reason, state: node.state, dependencies: dependencies.evaluations, conditions });
        continue;
      }
      if (node.action) reserveVirtualAction(node.action, availabilityCharacters);
      node.state = "AVAILABLE";
      executable.push({ strategy, node });
      records.push({ strategyId: strategy.strategy_id, nodeId: node.id, eligible: true, reason: "ready", state: node.state, dependencies: dependencies.evaluations, conditions });
    }
  }
  executable.sort((a, b) => a.strategy.strategy_id.localeCompare(b.strategy.strategy_id) || a.node.id.localeCompare(b.node.id));
  return { records, executable };
}

function weightedStats(character, configuredTerms) {
  return weightedMean(Object.entries(configuredTerms).map(([stat, weight]) => ({ value: character.resolved_stats[stat], weight: coefficient(weight) })));
}

function primitiveIdentity(snapshot, strategy, node, component) {
  return {
    seed: snapshot.seed,
    simulationId: snapshot.world.simulation_id,
    turn: snapshot.world.turn,
    actionId: `${strategy.strategy_id}:${node.id}`,
    targetId: node.primitive.target_ref ?? strategy.owner,
    component
  };
}

function resolveOpposedPrimitive(config, snapshot, strategy, node, definition) {
  const actor = snapshot.characters[node.primitive.actor_ref];
  const target = snapshot.characters[node.primitive.target_ref];
  if (!target) throw new ValidationError(`Opposed primitive ${node.id} requires a valid target.`);
  const actorBase = weightedStats(actor, definition.actor_terms) + (node.primitive.actor_adjustment ?? 0);
  const oppositionBase = weightedStats(target, definition.opposition_terms) + (node.primitive.opposition_adjustment ?? 0);
  const actorVariance = microVariance(config, primitiveIdentity(snapshot, strategy, node, "primitive.actor_term"));
  const oppositionVariance = microVariance(config, primitiveIdentity(snapshot, strategy, node, "primitive.opposition_term"));
  const actorTerm = roundTo(actorBase * actorVariance.factor);
  const oppositionTerm = roundTo(oppositionBase * oppositionVariance.factor);
  const margin = roundTo(actorTerm - oppositionTerm);
  const bands = config.specs["strategy.yaml"].primitive_resolution.outcome_bands;
  const band = margin < coefficient(bands.failed_below) ? "failure" : margin < coefficient(bands.partial_below) ? "partial" : "success";
  return {
    primitiveId: node.primitive.id,
    resolver: "OPPOSED_CONTEST",
    selectedActorStats: Object.keys(definition.actor_terms),
    selectedOppositionStats: Object.keys(definition.opposition_terms),
    actorBase,
    oppositionBase,
    actorVariance,
    oppositionVariance,
    actorTerm,
    oppositionTerm,
    margin,
    band,
    passed: band !== "failure"
  };
}

function resolveImmediateNode(config, snapshot, strategy, node) {
  node.state = "RESOLVING";
  if (node.kind === "CONDITION") {
    const passed = evaluateTemporalPredicate(node.condition, snapshot);
    return { strategyId: strategy.strategy_id, nodeId: node.id, kind: node.kind, resolver: "DECLARATIVE_CONDITION", passed, band: passed ? "success" : "failure" };
  }
  if (node.kind === "STATE_TRANSITION") return { strategyId: strategy.strategy_id, nodeId: node.id, kind: node.kind, resolver: "NORMALIZED_STATE_TRANSITION", passed: true, band: "success" };
  const primitives = config.specs["strategy.yaml"].primitive_resolution;
  const opposed = primitives.opposed_contests[node.primitive.id];
  if (opposed) return { strategyId: strategy.strategy_id, nodeId: node.id, kind: node.kind, ...resolveOpposedPrimitive(config, snapshot, strategy, node, opposed) };
  if (primitives.condition_backed[node.primitive.id]) {
    const passed = node.condition ? evaluateTemporalPredicate(node.condition, snapshot) : true;
    return { strategyId: strategy.strategy_id, nodeId: node.id, kind: node.kind, primitiveId: node.primitive.id, resolver: "DECLARATIVE_CONDITION", passed, band: passed ? "success" : "failure" };
  }
  return { strategyId: strategy.strategy_id, nodeId: node.id, kind: node.kind, primitiveId: node.primitive.id, resolver: "NORMALIZED_STATE_SETUP", passed: true, band: "success" };
}

export function beginStrategyStep(config, schedulerSnapshot, strategies) {
  const context = { ...schedulerSnapshot, temporal_state: schedulerSnapshot.temporal_state };
  const scheduled = scheduleStrategyNodes(strategies, context);
  const immediateResults = [];
  const actionBindings = [];
  for (const item of scheduled.executable) {
    const { strategy, node } = item;
    const actionBacked = node.kind === "ACTION"
      || (node.kind === "PRIMITIVE" && config.specs["strategy.yaml"].primitive_resolution.action_backed[node.primitive.id]);
    if (actionBacked) {
      if (!node.action) throw new ValidationError(`Action-backed strategy node ${node.id} requires a normalized action.`);
      node.state = "RESERVED";
      actionBindings.push({ strategyId: strategy.strategy_id, nodeId: node.id, action: deepClone(node.action) });
    } else {
      const result = resolveImmediateNode(config, schedulerSnapshot, strategy, node);
      node.state = result.passed ? "SUCCEEDED" : "FAILED";
      immediateResults.push({ ...result, state: node.state });
    }
  }
  return { eligibility: scheduled.records, immediateResults, actionBindings };
}

function actionPassed(rule, result) {
  if (!result) return false;
  if (rule === "RESOLVED") return result.outcome === "resolved";
  if (rule === "CONTACT") return result.contactCount > 0;
  if (rule === "NO_CONTACT") return result.contactCount === 0;
  if (rule === "CANCELLED") return result.outcome === "cancelled";
  return false;
}

function descendants(strategy, rootId) {
  const result = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of strategy.nodes) {
      if (result.has(node.id) || node.id === rootId) continue;
      if (node.dependencies.some((dependency) => dependency.node_id === rootId || result.has(dependency.node_id))) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

function applyFailurePolicy(strategy, failedNode, transitions) {
  const pending = (node) => !TERMINAL.has(node.state);
  if (failedNode.failure_policy === "CANCEL_DEPENDENTS") {
    for (const node of strategy.nodes.filter((candidate) => pending(candidate) && candidate.dependencies.some((dependency) => dependency.node_id === failedNode.id))) {
      node.state = "CANCELLED";
      transitions.push({ strategyId: strategy.strategy_id, nodeId: node.id, to: "CANCELLED", reason: "failure_policy:CANCEL_DEPENDENTS" });
    }
  } else if (failedNode.failure_policy === "CANCEL_BRANCH") {
    const branch = descendants(strategy, failedNode.id);
    for (const node of strategy.nodes.filter((candidate) => pending(candidate) && branch.has(candidate.id))) {
      node.state = "CANCELLED";
      transitions.push({ strategyId: strategy.strategy_id, nodeId: node.id, to: "CANCELLED", reason: "failure_policy:CANCEL_BRANCH" });
    }
  } else if (failedNode.failure_policy === "CANCEL_STRATEGY") {
    for (const node of strategy.nodes.filter(pending)) {
      node.state = "CANCELLED";
      transitions.push({ strategyId: strategy.strategy_id, nodeId: node.id, to: "CANCELLED", reason: "failure_policy:CANCEL_STRATEGY" });
    }
    strategy.state = "CANCELLED";
  } else if (failedNode.failure_policy === "ACTIVATE_FALLBACK") {
    for (const id of failedNode.fallback_node_ids) {
      const fallback = strategy.nodes.find((node) => node.id === id);
      if (fallback && !TERMINAL.has(fallback.state)) {
        fallback.state = "PENDING";
        transitions.push({ strategyId: strategy.strategy_id, nodeId: fallback.id, to: "PENDING", reason: "failure_policy:ACTIVATE_FALLBACK" });
      }
    }
  }
}

export function completeStrategyStep(strategies, startResult, actionResults) {
  const results = [...startResult.immediateResults];
  const transitions = startResult.immediateResults.map((result) => ({ strategyId: result.strategyId, nodeId: result.nodeId, to: result.state, reason: `resolver:${result.resolver}` }));
  const actions = new Map(actionResults.map((result) => [result.id, result]));
  for (const binding of startResult.actionBindings) {
    const strategy = strategies.find((candidate) => candidate.strategy_id === binding.strategyId);
    const node = strategy.nodes.find((candidate) => candidate.id === binding.nodeId);
    const actionResult = actions.get(binding.action.id);
    const passed = actionPassed(node.completion_rule, actionResult);
    node.state = passed ? "SUCCEEDED" : "FAILED";
    results.push({ strategyId: strategy.strategy_id, nodeId: node.id, kind: node.kind, resolver: "resolveTurn", actionId: binding.action.id, actionOutcome: actionResult?.outcome ?? "missing", passed, band: passed ? "success" : "failure", state: node.state });
    transitions.push({ strategyId: strategy.strategy_id, nodeId: node.id, to: node.state, reason: `action_completion:${node.completion_rule}` });
  }
  for (const strategy of [...strategies].sort((a, b) => a.strategy_id.localeCompare(b.strategy_id))) {
    for (const node of [...strategy.nodes].filter((candidate) => candidate.state === "FAILED").sort((a, b) => a.id.localeCompare(b.id))) applyFailurePolicy(strategy, node, transitions);
    if (strategy.state === "ACTIVE" && strategy.nodes.every((node) => TERMINAL.has(node.state))) {
      strategy.state = strategy.nodes.some((node) => node.state === "SUCCEEDED") ? "SUCCEEDED" : "FAILED";
    }
  }
  transitions.sort((a, b) => a.strategyId.localeCompare(b.strategyId) || a.nodeId.localeCompare(b.nodeId) || a.reason.localeCompare(b.reason));
  return { results, transitions };
}

export function strategyEffects(strategies, nodeResults) {
  const effects = [];
  for (const result of [...nodeResults].sort((a, b) => a.strategyId.localeCompare(b.strategyId) || a.nodeId.localeCompare(b.nodeId))) {
    const strategy = strategies.find((candidate) => candidate.strategy_id === result.strategyId);
    const node = strategy.nodes.find((candidate) => candidate.id === result.nodeId);
    const selected = result.passed ? node.effects.on_success : node.effects.on_failure;
    for (const effect of [...selected, ...node.effects.on_completion]) effects.push({ strategyId: strategy.strategy_id, nodeId: node.id, effect: deepClone(effect) });
  }
  return effects;
}

export function strategyDiagnostics(strategies, nodeResults, transitions, temporalEvents) {
  const terminal = strategies.flatMap((strategy) => strategy.nodes).filter((node) => TERMINAL.has(node.state));
  const succeeded = terminal.filter((node) => node.state === "SUCCEEDED").length;
  const failed = terminal.filter((node) => node.state === "FAILED").length;
  return {
    classification: "strategy_diagnostic",
    nonBlocking: true,
    executedNodes: nodeResults.length,
    succeededNodes: succeeded,
    failedNodes: failed,
    nodeSuccessRate: terminal.length ? succeeded / terminal.length : null,
    branchTransitions: transitions.filter((transition) => transition.reason.includes("failure_policy")).length,
    reactionConsumption: temporalEvents.filter((event) => event.type === "reaction_resolved").length,
    resourceExpenditure: temporalEvents.filter((event) => event.type === "temporal_resource_delta" && event.delta < 0).reduce((sum, event) => sum - event.delta, 0),
    unusedOpportunities: strategies.length ? null : 0
  };
}
