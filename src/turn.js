import { coefficient } from "./config.js";
import { ValidationError, ResolutionError } from "./errors.js";
import { immutableTurnSnapshot } from "./immutable.js";
import { planMultiAttack } from "./multi.js";
import { mergeStatuses } from "./status.js";
import { TurnReservationLedger, TurnTransaction } from "./transaction.js";
import { canonicalHash, clamp, deepClone, roundTo, stableStringify } from "./utils.js";

function actionBaseOrder(snapshot, left, right) {
  return (left.timing?.declared_at ?? 0) - (right.timing?.declared_at ?? 0)
    || (right.timing?.priority ?? 0) - (left.timing?.priority ?? 0)
    || snapshot.characters[right.actor_id].resolved_stats.movement - snapshot.characters[left.actor_id].resolved_stats.movement
    || left.id.localeCompare(right.id);
}

export function deterministicActionOrder(snapshot) {
  const byId = new Map(snapshot.actions.map((action) => [action.id, action]));
  const remaining = new Map(snapshot.actions.map((action) => [action.id, new Set(action.depends_on ?? [])]));
  const resolved = new Set();
  const ordered = [];
  while (ordered.length < snapshot.actions.length) {
    const ready = [...remaining]
      .filter(([id, dependencies]) => !resolved.has(id) && [...dependencies].every((dependency) => resolved.has(dependency)))
      .map(([id]) => byId.get(id))
      .sort((a, b) => actionBaseOrder(snapshot, a, b));
    if (!ready.length) throw new ValidationError("Action dependency graph must be acyclic.");
    const next = ready[0];
    ordered.push(next);
    resolved.add(next.id);
  }
  return ordered;
}

function reactionOrder(snapshot, actionsById, left, right) {
  const leftAction = actionsById.get(left.target_action_id);
  const rightAction = actionsById.get(right.target_action_id);
  return (leftAction.timing?.declared_at ?? 0) - (rightAction.timing?.declared_at ?? 0)
    || left.timing.latency_seconds - right.timing.latency_seconds
    || right.timing.priority - left.timing.priority
    || snapshot.characters[right.reactor_id].resolved_stats.reaction - snapshot.characters[left.reactor_id].resolved_stats.reaction
    || left.id.localeCompare(right.id);
}

function validateEconomy(character) {
  const economy = character.action_economy;
  const actionCapacity = economy.action_capacity ?? (economy.available ? 1 : 0);
  const actionsRemaining = economy.actions_remaining ?? (economy.available ? 1 : 0);
  const reactionCapacity = economy.reaction_capacity ?? (economy.reaction_available ? 1 : 0);
  const reactionsRemaining = economy.reactions_remaining ?? (economy.reaction_available ? 1 : 0);
  const actionsReserved = economy.actions_reserved ?? 0;
  const reactionsReserved = economy.reactions_reserved ?? 0;
  if (actionsRemaining > actionCapacity || actionsReserved > actionCapacity || reactionsRemaining > reactionCapacity || reactionsReserved > reactionCapacity) {
    throw new ValidationError(`Action economy exceeds declared capacity for ${character.id}.`);
  }
}

function validateDependencies(actions) {
  const ids = new Set(actions.map((action) => action.id));
  for (const action of actions) {
    for (const dependency of action.depends_on ?? []) {
      if (!ids.has(dependency)) throw new ValidationError(`Action ${action.id} depends on unknown action ${dependency}.`);
      if (dependency === action.id) throw new ValidationError(`Action ${action.id} cannot depend on itself.`);
    }
  }
}

function declaredCharacterTargets(action) {
  return action.targets
    .filter((target) => target.type === "character" || target.type === "self")
    .map((target) => target.type === "self" ? action.actor_id : target.ref);
}

export function targetAllocation(action) {
  if (action.kind !== "attack") return [];
  const targets = [...new Set(declaredCharacterTargets(action))].sort();
  const quantity = action.attack.quantity ?? 1;
  const targeting = action.attack.targeting ?? { mode: targets.length === 1 ? "SINGLE" : null, allocations: [] };
  if (!targeting.mode) throw new ValidationError(`Multi-target attack ${action.id} requires explicit targeting semantics.`);
  if (targeting.mode === "SINGLE") {
    if (targets.length !== 1) throw new ValidationError(`SINGLE attack ${action.id} must declare exactly one character target.`);
    return [{ targetId: targets[0], count: quantity }];
  }
  if (targeting.mode === "EACH_TARGET") return targets.map((targetId) => ({ targetId, count: quantity }));
  const allocations = [...(targeting.allocations ?? [])].sort((a, b) => a.target_ref.localeCompare(b.target_ref));
  const allocationIds = new Set();
  for (const allocation of allocations) {
    if (!targets.includes(allocation.target_ref)) throw new ValidationError(`Attack ${action.id} allocates to undeclared target ${allocation.target_ref}.`);
    if (allocationIds.has(allocation.target_ref)) throw new ValidationError(`Attack ${action.id} repeats target allocation ${allocation.target_ref}.`);
    allocationIds.add(allocation.target_ref);
  }
  const total = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  if (total !== quantity) throw new ValidationError(`Attack ${action.id} distributed quantity ${total} does not equal declared quantity ${quantity}.`);
  return allocations.filter((allocation) => allocation.quantity > 0).map((allocation) => ({ targetId: allocation.target_ref, count: allocation.quantity }));
}

function validateTurnMechanics(snapshot, config) {
  const actionIds = new Set();
  for (const [key, character] of Object.entries(snapshot.characters)) {
    if (key !== character.id) throw new ValidationError(`Character map key ${key} does not match character id ${character.id}.`);
    if (!snapshot.world.entity_refs.includes(character.id)) throw new ValidationError(`Character ${character.id} is absent from world.entity_refs.`);
    validateEconomy(character);
  }
  for (const action of snapshot.actions) {
    if (actionIds.has(action.id)) throw new ValidationError(`Duplicate action id: ${action.id}`);
    actionIds.add(action.id);
    if (!snapshot.characters[action.actor_id]) throw new ValidationError(`Action ${action.id} has unknown actor ${action.actor_id}.`);
    if (action.turn !== snapshot.world.turn) throw new ValidationError(`Action ${action.id} turn does not match world turn.`);
    for (const targetId of declaredCharacterTargets(action)) {
      if (!targetId || !snapshot.characters[targetId]) throw new ValidationError(`Action ${action.id} has invalid target reference ${targetId}.`);
    }
    if (action.kind === "attack") {
      targetAllocation(action);
      if (action.defense && !snapshot.registries.defense_sources[action.defense.source_ref]) {
        throw new ValidationError(`Action ${action.id} references unknown embedded defense source ${action.defense.source_ref}.`);
      }
      const shareTotal = Object.values(action.attack.channels).reduce((sum, share) => sum + share, 0);
      const tolerance = config.specs["invariants.yaml"].required_property_tests.batch_conservation.tolerance.value;
      if (Math.abs(shareTotal - 1) > tolerance) throw new ValidationError(`Attack ${action.id} channel shares sum to ${shareTotal}, not 1.`);
      for (const attempt of action.attack.status_effects) {
        if (!snapshot.registries.status_definitions[attempt.status_id]) throw new ValidationError(`Action ${action.id} references unknown status ${attempt.status_id}.`);
      }
    }
    for (const claim of action.effects?.displacements ?? []) {
      if (!snapshot.characters[claim.target_ref]) throw new ValidationError(`Action ${action.id} displacement references unknown target ${claim.target_ref}.`);
    }
    for (const removal of action.effects?.status_removals ?? []) {
      if (!snapshot.characters[removal.target_ref]) throw new ValidationError(`Action ${action.id} status removal references unknown target ${removal.target_ref}.`);
    }
  }
  validateDependencies(snapshot.actions);
  const reactionIds = new Set();
  const maximumDepth = coefficient(config.specs["combat-loop.yaml"].reactions.maximum_chain_depth);
  for (const reaction of snapshot.reactions) {
    if (reactionIds.has(reaction.id)) throw new ValidationError(`Duplicate reaction id: ${reaction.id}`);
    reactionIds.add(reaction.id);
    if (!snapshot.characters[reaction.reactor_id]) throw new ValidationError(`Reaction ${reaction.id} has unknown reactor ${reaction.reactor_id}.`);
    if (!actionIds.has(reaction.target_action_id)) throw new ValidationError(`Reaction ${reaction.id} targets unknown action ${reaction.target_action_id}.`);
    if (reaction.timing.chain_depth > maximumDepth) throw new ValidationError(`Reaction ${reaction.id} exceeds maximum chain depth ${maximumDepth}.`);
    if (reaction.effect.kind === "DEFEND" && !snapshot.registries.defense_sources[reaction.defense.source_ref]) {
      throw new ValidationError(`Reaction ${reaction.id} references unknown defense source ${reaction.defense.source_ref}.`);
    }
    if (reaction.effect.kind === "INTERRUPT" && reaction.effect.consequence === "ALTER_TARGET" && !snapshot.characters[reaction.effect.alternate_target_ref]) {
      throw new ValidationError(`Reaction ${reaction.id} has invalid alternate target ${reaction.effect.alternate_target_ref}.`);
    }
  }
  return {
    actionCount: snapshot.actions.length,
    reactionCount: snapshot.reactions.length,
    characterCount: Object.keys(snapshot.characters).length,
    actionIds: [...actionIds].sort(),
    reactionIds: [...reactionIds].sort(),
    registryHashes: {
      defenseSources: canonicalHash(snapshot.registries.defense_sources),
      statusDefinitions: canonicalHash(snapshot.registries.status_definitions)
    }
  };
}

function plannedHitCount(action) {
  return action.kind === "attack" ? targetAllocation(action).reduce((sum, allocation) => sum + allocation.count, 0) : 1;
}

function costAmount(cost, hitCount, targetCount, durationSeconds, contactCount = hitCount) {
  const timingScale = cost.timing === "per_second" ? durationSeconds : cost.timing === "per_target" ? targetCount : 1;
  const mode = cost.mode ?? "PER_ACTION";
  const relevantHits = cost.timing === "on_contact" ? contactCount : hitCount;
  if (mode === "PER_HIT") return roundTo(cost.amount * timingScale * relevantHits);
  if (mode === "UPFRONT_PLUS_PER_HIT") return roundTo((cost.upfront_amount + cost.per_hit_amount * relevantHits) * timingScale);
  if (cost.timing === "on_contact" && contactCount === 0) return 0;
  return roundTo(cost.amount * timingScale);
}

export function actionCostPlan(action, contactCount = null) {
  const hitCount = plannedHitCount(action);
  const targetCount = Math.max(1, declaredCharacterTargets(action).length);
  const durationSeconds = action.timing?.duration_seconds ?? 1;
  return action.costs.map((cost, index) => ({
    index,
    resource: cost.resource,
    mode: cost.mode ?? "PER_ACTION",
    timing: cost.timing,
    maximumAmount: costAmount(cost, hitCount, targetCount, durationSeconds, hitCount),
    committedAmount: costAmount(cost, hitCount, targetCount, durationSeconds, contactCount ?? hitCount)
  }));
}

function implicitLegacyReactions(snapshot, config) {
  const existing = new Set(snapshot.reactions.map((reaction) => `${reaction.target_action_id}\u001f${reaction.reactor_id}`));
  const reactions = [];
  const defenseSpec = config.specs["defense.yaml"].resolution.step_10_cost;
  for (const action of snapshot.actions) {
    if (action.kind !== "attack" || !action.defense) continue;
    for (const targetId of declaredCharacterTargets(action)) {
      if (existing.has(`${action.id}\u001f${targetId}`)) continue;
      const target = snapshot.characters[targetId];
      const efficiency = clamp(
        coefficient(defenseSpec.min_efficiency),
        coefficient(defenseSpec.max_efficiency),
        coefficient(defenseSpec.base_efficiency) + target.resolved_stats.energy_efficiency * coefficient(defenseSpec.per_stat)
      );
      reactions.push({
        id: `legacy-defense:${action.id}:${targetId}`,
        reactor_id: targetId,
        target_action_id: action.id,
        trigger: "HIT_PENDING",
        method: action.defense.method === "extension" ? "block" : action.defense.method,
        timing: { latency_seconds: 0, priority: 0, chain_depth: 0 },
        cost: { resource: action.defense.cost.resource, amount: roundTo(action.defense.cost.amount / efficiency) },
        action_economy_cost: 1,
        coverage: { scope: "ONE_HIT", maximum_hits: 1, target_refs: [targetId] },
        defense: { source_ref: action.defense.source_ref, declared_coverage: action.defense.declared_coverage },
        effect: { kind: "DEFEND" },
        tags: ["legacy_embedded_defense"]
      });
    }
  }
  return reactions;
}

function hitDescriptors(action) {
  let globalIndex = 0;
  return targetAllocation(action).flatMap((allocation) => Array.from({ length: allocation.count }, (_, targetIndex) => ({
    actionId: action.id,
    targetId: allocation.targetId,
    hitIndex: globalIndex++,
    targetHitIndex: targetIndex
  })));
}

function reactionDesiredHits(reaction, descriptors, action) {
  const coverage = reaction.coverage;
  let candidates = descriptors;
  const defaultTargets = reaction.method === "intercept" || reaction.method === "barrier"
    ? declaredCharacterTargets(action)
    : [reaction.reactor_id];
  const targetRefs = coverage.target_refs?.length ? coverage.target_refs : defaultTargets;
  candidates = candidates.filter((hit) => targetRefs.includes(hit.targetId));
  if (coverage.scope === "HIT_SUBSET") candidates = candidates.filter((hit) => (coverage.hit_indices ?? []).includes(hit.hitIndex));
  if (coverage.scope === "TIME_WINDOW") {
    const actionTime = action.timing?.declared_at ?? 0;
    candidates = actionTime >= (coverage.start_seconds ?? 0) && actionTime <= (coverage.end_seconds ?? Infinity) ? candidates : [];
  }
  return candidates;
}

function canReserveReaction(snapshot, ledger, reaction) {
  const economy = snapshot.characters[reaction.reactor_id].action_economy;
  const capacity = economy.reactions_remaining ?? (economy.reaction_available ? 1 : 0);
  if (ledger.reactionTotal(reaction.reactor_id) + reaction.action_economy_cost > capacity) return { ok: false, reason: "reaction_capacity_exhausted" };
  const available = snapshot.characters[reaction.reactor_id].resources[reaction.cost.resource]?.current;
  if (!Number.isFinite(available)) return { ok: false, reason: "unknown_reaction_resource" };
  if (ledger.resourceTotal(reaction.reactor_id, reaction.cost.resource) + reaction.cost.amount > available + 1e-12) return { ok: false, reason: "insufficient_reaction_resource" };
  return { ok: true };
}

function prepareReactions(snapshot, config, ledger, orderedActions) {
  const actionsById = new Map(orderedActions.map((action) => [action.id, action]));
  const all = [...snapshot.reactions, ...implicitLegacyReactions(snapshot, config)]
    .sort((a, b) => reactionOrder(snapshot, actionsById, a, b));
  const claimedHits = new Map();
  const actionInterruptions = new Map();
  const results = [];
  for (const reaction of all) {
    const action = actionsById.get(reaction.target_action_id);
    const descriptors = action.kind === "attack" ? hitDescriptors(action) : [];
    let desired = reaction.effect.kind === "DEFEND" ? reactionDesiredHits(reaction, descriptors, action) : [];
    if (reaction.effect.kind === "DEFEND") {
      const claimed = claimedHits.get(action.id) ?? new Set();
      desired = desired.filter((hit) => !claimed.has(hit.hitIndex));
      if (reaction.coverage.scope === "ONE_HIT") desired = desired.slice(0, 1);
      if (reaction.coverage.maximum_hits !== null && reaction.coverage.maximum_hits !== undefined) desired = desired.slice(0, reaction.coverage.maximum_hits);
      if (!desired.length) {
        results.push({ id: reaction.id, targetActionId: action.id, reactorId: reaction.reactor_id, outcome: "unavailable", reason: "no_unclaimed_covered_hit", coveredHits: [] });
        continue;
      }
    }
    if (reaction.effect.kind === "INTERRUPT" && reaction.timing.latency_seconds > (action.timing?.interrupt_window_seconds ?? 0)) {
      results.push({ id: reaction.id, targetActionId: action.id, reactorId: reaction.reactor_id, outcome: "ineligible", reason: "missed_interrupt_window", coveredHits: [] });
      continue;
    }
    const reservation = canReserveReaction(snapshot, ledger, reaction);
    if (!reservation.ok) {
      results.push({ id: reaction.id, targetActionId: action.id, reactorId: reaction.reactor_id, outcome: "unavailable", reason: reservation.reason, coveredHits: [] });
      continue;
    }
    ledger.reserveReaction(reaction.reactor_id, reaction.action_economy_cost, `reaction:${reaction.id}`);
    ledger.reserveResource(reaction.reactor_id, reaction.cost.resource, reaction.cost.amount, `reaction:${reaction.id}`);
    let effectApplied = false;
    let interruption = null;
    if (reaction.effect.kind === "DEFEND") {
      const claimed = claimedHits.get(action.id) ?? new Set();
      for (const hit of desired) claimed.add(hit.hitIndex);
      claimedHits.set(action.id, claimed);
      effectApplied = true;
    } else {
      const resistance = action.attack?.interrupt_resistance ?? 0;
      const margin = reaction.effect.potency - resistance;
      effectApplied = margin >= 0;
      interruption = { consequence: reaction.effect.consequence, potency: reaction.effect.potency, resistance, margin, success: effectApplied };
      if (effectApplied) {
        const state = actionInterruptions.get(action.id) ?? { cancelled: false, delaySeconds: 0, executionMultiplier: 1, alternateTargetRef: null, concentrationBroken: false, sources: [] };
        if (reaction.effect.consequence === "CANCEL_ACTION") state.cancelled = true;
        if (reaction.effect.consequence === "DELAY_ACTION") state.delaySeconds = roundTo(state.delaySeconds + (reaction.effect.delay_seconds ?? 0));
        if (reaction.effect.consequence === "REDUCE_EXECUTION") state.executionMultiplier = roundTo(state.executionMultiplier * (1 - (reaction.effect.magnitude ?? 0)));
        if (reaction.effect.consequence === "ALTER_TARGET") state.alternateTargetRef = reaction.effect.alternate_target_ref;
        if (reaction.effect.consequence === "BREAK_CONCENTRATION") state.concentrationBroken = true;
        state.sources.push(reaction.id);
        actionInterruptions.set(action.id, state);
      }
    }
    results.push({
      id: reaction.id,
      targetActionId: action.id,
      reactorId: reaction.reactor_id,
      outcome: effectApplied ? "applied" : "failed",
      method: reaction.method,
      effect: deepClone(reaction.effect),
      interruption,
      resourceCost: deepClone(reaction.cost),
      actionEconomyCost: reaction.action_economy_cost,
      coveredHits: desired.map((hit) => ({ targetId: hit.targetId, hitIndex: hit.hitIndex })),
      declaration: reaction
    });
  }
  return { ordered: all, results, actionInterruptions };
}

function mappedDefenseMethod(method) {
  if (method === "dodge" || method === "movement") return "evade";
  if (method === "intercept" || method === "counter") return "counterguard";
  return method;
}

function reactionForHit(reactionResults, actionId, hitIndex) {
  return reactionResults.find((reaction) => reaction.outcome === "applied"
    && reaction.effect.kind === "DEFEND"
    && reaction.targetActionId === actionId
    && reaction.coveredHits.some((hit) => hit.hitIndex === hitIndex));
}

function executableAction(action, interruption) {
  const result = deepClone(action);
  if (interruption?.alternateTargetRef) {
    result.targets = [{ type: "character", ref: interruption.alternateTargetRef, position: null, body_zone: null }];
    if (result.attack) result.attack.targeting = { mode: "SINGLE", allocations: [] };
  }
  if (interruption?.executionMultiplier !== undefined && interruption.executionMultiplier !== 1) {
    result.modifiers.push({
      id: `core.interrupt.${action.id}.accuracy`, layer: "ACTION", target: "attack.accuracy", operation: "multiplicative",
      value: interruption.executionMultiplier, priority: 0, source_ref: interruption.sources.join(",")
    });
    result.modifiers.push({
      id: `core.interrupt.${action.id}.power`, layer: "ACTION", target: "attack.power", operation: "multiplicative",
      value: interruption.executionMultiplier, priority: 0, source_ref: interruption.sources.join(",")
    });
  }
  return result;
}

function makeHitInput(snapshot, action, descriptor, reactionResult, seed, suffix) {
  const actor = snapshot.characters[action.actor_id];
  const target = deepClone(snapshot.characters[descriptor.targetId]);
  const hitAction = deepClone(action);
  hitAction.id = `${action.id}::${suffix}`;
  hitAction.targets = [action.targets.find((candidate) => candidate.ref === descriptor.targetId) ?? { type: "character", ref: descriptor.targetId, position: null, body_zone: null }];
  hitAction.attack.quantity = 1;
  hitAction.attack.targeting = { mode: "SINGLE", allocations: [] };
  hitAction.costs = [];
  hitAction.depends_on = [];
  hitAction.effects = {};
  if (reactionResult) {
    target.action_economy.reaction_available = true;
    hitAction.defense = {
      method: mappedDefenseMethod(reactionResult.method),
      source_ref: reactionResult.declaration.defense.source_ref,
      declared_coverage: reactionResult.declaration.defense.declared_coverage,
      cost: { resource: reactionResult.resourceCost.resource, amount: 0, timing: "reserve", mode: "PER_ACTION" },
      fallback_method: null
    };
  } else {
    hitAction.defense = null;
  }
  return { world: snapshot.world, actor, target, action: hitAction, registries: snapshot.registries, seed, trace: true };
}

function aggregateHit(result, count, descriptor, kind, startIndex) {
  const appliedStatuses = result.trace.statuses
    .filter((status) => status.outcome !== "resisted" && status.durationTurns > 0)
    .map((status) => ({ statusId: status.status_id, sourceRef: result.trace.inputHashes.action, intensity: roundTo(status.potency), remainingTurns: status.durationTurns, count }));
  return {
    kind,
    targetId: descriptor.targetId,
    startIndex,
    count,
    quality: result.quality,
    contactCount: result.trace.accuracy.exposureFactor > 0 ? count : 0,
    healthDamage: roundTo(result.healthDamage * count),
    stabilityDamage: roundTo(result.stabilityDamage * count),
    defenseFilter: result.defenseFilter,
    statuses: appliedStatuses,
    trace: result.trace
  };
}

function staticBatchSafety(action, relevantReactions) {
  const reasons = [];
  if (action.attack.batch_safety === "FORCE_INDIVIDUAL") reasons.push("forced_individual");
  if (action.attack.status_effects.length) reasons.push("unaggregated_status_transition");
  if (action.tags.includes("batch_unsafe") || action.tags.includes("heterogeneous_projectiles")) reasons.push("explicit_or_heterogeneous");
  if (relevantReactions.some((reaction) => ["ONE_HIT", "HIT_SUBSET"].includes(reaction.declaration.coverage.scope))) reasons.push("hit_scoped_reaction");
  return { safe: reasons.length === 0, reasons };
}

function resolveAttackAction(engine, snapshot, originalAction, interruption, reactionResults, seed, forceIndividual) {
  const action = executableAction(originalAction, interruption);
  const allocations = targetAllocation(action);
  const relevantReactions = reactionResults.filter((reaction) => reaction.outcome === "applied" && reaction.targetActionId === originalAction.id && reaction.effect.kind === "DEFEND");
  const threshold = coefficient(engine.config.specs["attack.yaml"].multi_attack.individual_resolution_max_count);
  const guard = coefficient(engine.config.specs["attack.yaml"].multi_attack.safety.accuracy_threshold_guard);
  const staticSafety = staticBatchSafety(action, relevantReactions);
  const hits = [];
  let globalIndex = 0;
  let batched = false;
  const unsafeReasons = [...staticSafety.reasons];
  for (const allocation of allocations) {
    const firstDescriptor = { actionId: originalAction.id, targetId: allocation.targetId, hitIndex: globalIndex, targetHitIndex: 0 };
    const firstReaction = reactionForHit(reactionResults, originalAction.id, globalIndex);
    const first = engine.resolveEncounter(makeHitInput(snapshot, action, firstDescriptor, firstReaction, `${seed}:action:${originalAction.id}:target:${allocation.targetId}:index:${globalIndex}`, `probe:${allocation.targetId}:${globalIndex}`));
    const thresholdDistance = Math.min(...[-20, 0, 20].map((value) => Math.abs(first.trace.accuracy.margin - value)));
    const canBatch = !forceIndividual && allocation.count > threshold && staticSafety.safe && thresholdDistance > guard;
    if (action.attack.batch_safety === "REQUIRE_SAFE_BATCH" && !canBatch) {
      throw new ValidationError(`Action ${action.id} requires safe batching but safety checks failed: ${[...unsafeReasons, thresholdDistance <= guard ? "accuracy_threshold_guard" : "below_batch_threshold"].join(", ")}`);
    }
    if (canBatch) {
      batched = true;
      const plan = planMultiAttack(engine.config, allocation.count, action.attack.power, {});
      for (const group of plan.groups) {
        const descriptor = { actionId: originalAction.id, targetId: allocation.targetId, hitIndex: globalIndex + group.startIndex, targetHitIndex: group.startIndex };
        const reaction = reactionForHit(reactionResults, originalAction.id, descriptor.hitIndex);
        const result = group.startIndex === 0
          ? first
          : engine.resolveEncounter(makeHitInput(snapshot, action, descriptor, reaction, `${seed}:action:${originalAction.id}:target:${allocation.targetId}:index:${descriptor.hitIndex}`, `batch:${allocation.targetId}:${descriptor.hitIndex}`));
        hits.push(aggregateHit(result, group.count, descriptor, "batch", descriptor.hitIndex));
      }
    } else {
      if (allocation.count > threshold && thresholdDistance <= guard) unsafeReasons.push("accuracy_threshold_guard");
      for (let targetIndex = 0; targetIndex < allocation.count; targetIndex += 1) {
        const descriptor = { actionId: originalAction.id, targetId: allocation.targetId, hitIndex: globalIndex + targetIndex, targetHitIndex: targetIndex };
        const reaction = reactionForHit(reactionResults, originalAction.id, descriptor.hitIndex);
        const result = targetIndex === 0
          ? first
          : engine.resolveEncounter(makeHitInput(snapshot, action, descriptor, reaction, `${seed}:action:${originalAction.id}:target:${allocation.targetId}:index:${descriptor.hitIndex}`, `hit:${allocation.targetId}:${descriptor.hitIndex}`));
        hits.push(aggregateHit(result, 1, descriptor, "individual", descriptor.hitIndex));
      }
    }
    globalIndex += allocation.count;
  }
  const qualityCounts = { miss: 0, graze: 0, partial: 0, solid: 0 };
  for (const hit of hits) qualityCounts[hit.quality] += hit.count;
  return {
    id: originalAction.id,
    actorId: originalAction.actor_id,
    kind: "attack",
    outcome: "resolved",
    resolutionMode: batched ? "batch" : "individual",
    batchSafe: batched,
    batchSafetyReasons: [...new Set(unsafeReasons)].sort(),
    declaredQuantity: originalAction.attack.quantity ?? 1,
    representedHitCount: hits.reduce((sum, hit) => sum + hit.count, 0),
    targetAllocation: allocations,
    qualityCounts,
    contactCount: hits.reduce((sum, hit) => sum + hit.contactCount, 0),
    healthDamage: roundTo(hits.reduce((sum, hit) => sum + hit.healthDamage, 0)),
    stabilityDamage: roundTo(hits.reduce((sum, hit) => sum + hit.stabilityDamage, 0)),
    hits
  };
}

function resolveNonAttackAction(snapshot, action) {
  if (action.kind === "movement") {
    const actor = snapshot.characters[action.actor_id];
    const destination = action.movement.destination;
    const distance = Math.hypot(destination.x - actor.transform.position.x, destination.y - actor.transform.position.y, destination.z - actor.transform.position.z);
    if (distance > action.movement.maximum_distance + 1e-12) throw new ValidationError(`Movement action ${action.id} exceeds maximum distance.`);
  }
  return { id: action.id, actorId: action.actor_id, kind: action.kind, outcome: "resolved", representedHitCount: 0, contactCount: 0, healthDamage: 0, stabilityDamage: 0, hits: [] };
}

function actionEffects(action, result) {
  const claims = [];
  if (action.kind === "movement") claims.push({ characterId: action.actor_id, mode: "ASSIGN", vector: action.movement.destination, priority: action.timing?.priority ?? 0, actionId: action.id });
  for (const claim of action.effects?.displacements ?? []) {
    if (claim.requires_contact && result.contactCount === 0) continue;
    claims.push({ characterId: claim.target_ref, mode: claim.mode, vector: claim.vector, priority: claim.priority, actionId: action.id });
  }
  return {
    displacements: claims,
    statusRemovals: (action.effects?.status_removals ?? []).map((removal) => ({ characterId: removal.target_ref, statusId: removal.status_id, sourceRef: action.id }))
  };
}

function mergeDisplacements(characters, claims, spatialBounds) {
  const conflicts = [];
  const changes = [];
  const grouped = new Map();
  for (const claim of claims) grouped.set(claim.characterId, [...(grouped.get(claim.characterId) ?? []), claim]);
  for (const [characterId, characterClaims] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const assigns = characterClaims.filter((claim) => claim.mode === "ASSIGN");
    const deltas = characterClaims.filter((claim) => claim.mode === "DELTA");
    const uniqueAssignments = new Map(assigns.map((claim) => [stableStringify(claim.vector), claim]));
    let base = deepClone(characters[characterId].transform.position);
    let winner = null;
    if (uniqueAssignments.size) {
      winner = [...uniqueAssignments.values()].sort((a, b) => b.priority - a.priority || a.actionId.localeCompare(b.actionId))[0];
      base = deepClone(winner.vector);
    }
    if (uniqueAssignments.size > 1) {
      conflicts.push({
        code: "GEOMETRY_ASSIGNMENT_CONFLICT",
        characterId,
        policy: "highest_explicit_priority_then_action_id",
        winner: winner.actionId,
        claims: assigns.map((claim) => ({ actionId: claim.actionId, priority: claim.priority, vector: claim.vector }))
      });
    }
    const delta = deltas.reduce((sum, claim) => ({ x: sum.x + claim.vector.x, y: sum.y + claim.vector.y, z: sum.z + claim.vector.z }), { x: 0, y: 0, z: 0 });
    const result = { x: base.x + delta.x, y: base.y + delta.y, z: base.z + delta.z };
    if (spatialBounds) {
      result.x = clamp(spatialBounds.min.x, spatialBounds.max.x, result.x);
      result.y = clamp(spatialBounds.min.y, spatialBounds.max.y, result.y);
      result.z = clamp(spatialBounds.min.z, spatialBounds.max.z, result.z);
    }
    const before = deepClone(characters[characterId].transform.position);
    characters[characterId].transform.position = result;
    changes.push({ characterId, before, after: deepClone(result), assignmentSource: winner?.actionId ?? null, additiveSources: deltas.map((claim) => claim.actionId).sort() });
  }
  return { conflicts, changes };
}

function applyTurnCommit(working, staged, config, advanceTime = true) {
  const payload = staged[0];
  const characters = working.characters;
  const resourceChanges = [];
  const economyChanges = [];
  const statusChanges = [];
  const conflicts = [...payload.preCommitConflicts];
  const resourceGroups = new Map();
  for (const delta of payload.resourceDeltas) {
    const key = `${delta.characterId}\u001f${delta.resource}`;
    resourceGroups.set(key, (resourceGroups.get(key) ?? 0) + delta.delta);
  }
  for (const [key, delta] of [...resourceGroups].sort(([a], [b]) => a.localeCompare(b))) {
    const [characterId, resource] = key.split("\u001f");
    const state = characters[characterId].resources[resource];
    const before = state.current;
    const after = roundTo(before + delta);
    const depletedResource = resource === "health" || resource === "stability";
    if ((!depletedResource && after < -1e-9) || after > state.maximum + 1e-9) throw new ResolutionError(`Committed ${resource} for ${characterId} would be outside 0..maximum.`);
    state.current = clamp(0, state.maximum, after);
    resourceChanges.push({ characterId, resource, before, after: state.current, delta: roundTo(state.current - before) });
  }
  for (const [characterId, amount] of [...payload.actionEconomyDeltas].sort(([a], [b]) => a.localeCompare(b))) {
    const economy = characters[characterId].action_economy;
    const before = economy.actions_remaining ?? (economy.available ? 1 : 0);
    const after = before - amount;
    if (after < 0) throw new ResolutionError(`Action capacity became negative for ${characterId}.`);
    economy.action_capacity ??= before;
    economy.actions_remaining = after;
    economy.actions_reserved = 0;
    economy.available = after > 0;
    economyChanges.push({ characterId, kind: "action", before, after, consumed: amount });
  }
  for (const [characterId, amount] of [...payload.reactionEconomyDeltas].sort(([a], [b]) => a.localeCompare(b))) {
    const economy = characters[characterId].action_economy;
    const before = economy.reactions_remaining ?? (economy.reaction_available ? 1 : 0);
    const after = before - amount;
    if (after < 0) throw new ResolutionError(`Reaction capacity became negative for ${characterId}.`);
    economy.reaction_capacity ??= before;
    economy.reactions_remaining = after;
    economy.reactions_reserved = 0;
    economy.reaction_available = after > 0;
    economyChanges.push({ characterId, kind: "reaction", before, after, consumed: amount });
  }
  for (const [characterId, amount] of [...payload.movementEconomyDeltas].sort(([a], [b]) => a.localeCompare(b))) {
    const character = characters[characterId];
    if (!Number.isInteger(character.movement_economy)) throw new ResolutionError(`Movement economy is not declared for ${characterId}.`);
    const before = character.movement_economy;
    const after = before - amount;
    if (after < 0) throw new ResolutionError(`Movement capacity became negative for ${characterId}.`);
    character.movement_economy = after;
    economyChanges.push({ characterId, kind: "movement", before, after, consumed: amount });
  }
  const statusCharacters = new Set([...payload.statusAdditions.map((item) => item.characterId), ...payload.statusRemovals.map((item) => item.characterId)]);
  for (const characterId of [...statusCharacters].sort()) {
    const additions = payload.statusAdditions.filter((item) => item.characterId === characterId);
    const removals = payload.statusRemovals.filter((item) => item.characterId === characterId);
    const merged = mergeStatuses(characters[characterId].statuses, additions, removals, working.registries.status_definitions);
    characters[characterId].statuses = merged.statuses;
    statusChanges.push(...merged.changes.map((change) => ({ characterId, ...change })));
    conflicts.push(...merged.conflicts.map((conflict) => ({ characterId, ...conflict })));
  }
  const displacement = mergeDisplacements(characters, payload.displacements, working.world.spatial_bounds);
  conflicts.push(...displacement.conflicts);
  const knockout = coefficient(config.specs["damage.yaml"].resource_and_state_commit.knockout_default_health);
  for (const character of Object.values(characters)) {
    if (character.resources.health.current <= knockout) character.transform.posture = "incapacitated";
  }
  const events = payload.events.map((event, sequence) => ({ sequence, ...event }));
  const previous = {
    turn: working.world.turn,
    snapshot_hash: payload.startingSnapshotHash,
    action_refs: payload.actionRefs,
    events,
    resource_deltas: resourceChanges.map((change) => ({ character_id: change.characterId, resource: change.resource, delta: change.delta })),
    created_modifier_ids: [],
    expired_modifier_ids: [],
    status_changes: statusChanges,
    action_economy_changes: economyChanges,
    displacement_changes: displacement.changes,
    conflicts,
    resulting_snapshot_hash: null,
    summary_tags: [...new Set(["combat_turn", ...payload.summaryTags])].sort()
  };
  if (advanceTime) {
    working.world.turn += 1;
    working.world.time.elapsed_seconds = roundTo(working.world.time.elapsed_seconds + working.world.time.turn_duration_seconds);
    working.world.previous_turn = previous;
    previous.resulting_snapshot_hash = canonicalHash({ world: working.world, characters });
  }
  return { world: working.world, characters, events, resourceChanges, economyChanges, statusChanges, displacementChanges: displacement.changes, conflicts, previousTurn: previous };
}

function validateCommitted(engine, result) {
  engine.schemas.validate("world", result.world);
  for (const character of Object.values(result.characters)) engine.schemas.validate("character", character);
}

function mechanicalTurnResult(result) {
  return {
    outcome: result.outcome,
    world: result.world,
    characters: result.characters,
    actionResults: result.actionResults,
    reactionResults: result.reactionResults,
    events: result.events,
    conflicts: result.conflicts
  };
}

export function resolveTurn(engine, input) {
  engine.schemas.validate("turn", input);
  const snapshot = immutableTurnSnapshot(input);
  const validation = validateTurnMechanics(snapshot, engine.config);
  const orderedActions = deterministicActionOrder(snapshot);
  const ledger = new TurnReservationLedger(snapshot);
  const reservations = new Map();
  try {
    for (const action of orderedActions) {
      const economyClass = action.economy_class ?? "ACTION";
      if (economyClass === "REACTION") {
        if (!ledger.reserveReaction(action.actor_id, 1, `action:${action.id}`)) throw new ResolutionError(`Character ${action.actor_id} lacks reaction capacity.`);
      } else if (economyClass === "MOVEMENT" && Number.isInteger(snapshot.characters[action.actor_id].movement_economy)) {
        ledger.reserveMovement(action.actor_id, 1, `action:${action.id}`);
      } else if (economyClass !== "PASSIVE") {
        ledger.reserveAction(action.actor_id, 1, `action:${action.id}`);
      }
      const plan = actionCostPlan(action);
      for (const cost of plan) ledger.reserveResource(action.actor_id, cost.resource, cost.maximumAmount, `action:${action.id}:cost:${cost.index}`);
      reservations.set(action.id, plan);
    }
  } catch (error) {
    return Object.freeze({
      outcome: "aborted",
      reason: error instanceof Error ? error.message : String(error),
      world: snapshot.world,
      characters: snapshot.characters,
      actionResults: [], reactionResults: [], events: [], conflicts: [],
      trace: input.trace === false ? undefined : { specVersion: engine.config.version, seed: snapshot.seed, startingSnapshotHash: canonicalHash({ world: snapshot.world, characters: snapshot.characters }), declarations: { actions: snapshot.actions, reactions: snapshot.reactions }, validation, reservations: ledger.records(), pipeline: ["snapshot", "declaration_validation", "resource_and_economy_reservation", "aborted"] }
    });
  }
  const prepared = prepareReactions(snapshot, engine.config, ledger, orderedActions);
  const actionResults = [];
  const resourceDeltas = [];
  const actionEconomyDeltas = new Map();
  const reactionEconomyDeltas = new Map();
  const movementEconomyDeltas = new Map();
  const statusAdditions = [];
  const statusRemovals = [];
  const displacements = [];
  const events = [];
  const dependencyOutcomes = new Map();

  for (const action of orderedActions) {
    const interruption = prepared.actionInterruptions.get(action.id);
    const dependencyCancelled = (action.depends_on ?? []).some((id) => dependencyOutcomes.get(id) !== "resolved");
    let result;
    if (interruption?.cancelled || dependencyCancelled || (interruption?.concentrationBroken && action.tags.includes("concentration"))) {
      result = { id: action.id, actorId: action.actor_id, kind: action.kind, outcome: "cancelled", reason: dependencyCancelled ? "dependency_unavailable" : "explicit_interruption", representedHitCount: 0, contactCount: 0, healthDamage: 0, stabilityDamage: 0, hits: [] };
    } else if (action.kind === "attack") {
      result = resolveAttackAction(engine, snapshot, action, interruption, prepared.results, snapshot.seed, input.force_individual === true);
    } else {
      result = resolveNonAttackAction(snapshot, action);
    }
    const committedCosts = actionCostPlan(action, result.contactCount);
    result.costs = committedCosts;
    result.interruption = interruption ?? null;
    for (const cost of committedCosts) {
      const payable = result.outcome === "cancelled" && cost.timing === "on_contact" ? 0 : cost.committedAmount;
      if (payable) resourceDeltas.push({ characterId: action.actor_id, resource: cost.resource, delta: -payable, sourceRef: action.id });
    }
    const economyClass = action.economy_class ?? "ACTION";
    if (economyClass === "REACTION") reactionEconomyDeltas.set(action.actor_id, (reactionEconomyDeltas.get(action.actor_id) ?? 0) + 1);
    else if (economyClass === "MOVEMENT" && Number.isInteger(snapshot.characters[action.actor_id].movement_economy)) movementEconomyDeltas.set(action.actor_id, (movementEconomyDeltas.get(action.actor_id) ?? 0) + 1);
    else if (economyClass !== "PASSIVE") actionEconomyDeltas.set(action.actor_id, (actionEconomyDeltas.get(action.actor_id) ?? 0) + 1);
    if (result.kind === "attack") {
      for (const hit of result.hits) {
        if (hit.healthDamage) resourceDeltas.push({ characterId: hit.targetId, resource: "health", delta: -hit.healthDamage, sourceRef: action.id });
        if (hit.stabilityDamage) resourceDeltas.push({ characterId: hit.targetId, resource: "stability", delta: -hit.stabilityDamage, sourceRef: action.id });
        for (const status of hit.statuses) {
          for (let index = 0; index < status.count; index += 1) statusAdditions.push({ characterId: hit.targetId, statusId: status.statusId, sourceRef: `${action.id}:${hit.startIndex + index}`, intensity: status.intensity, remainingTurns: status.remainingTurns });
        }
      }
    }
    const effects = actionEffects(action, result);
    displacements.push(...effects.displacements);
    statusRemovals.push(...effects.statusRemovals);
    actionResults.push(result);
    dependencyOutcomes.set(action.id, result.outcome);
    events.push({ type: "action_resolved", actor_refs: [action.actor_id], target_refs: declaredCharacterTargets(action).sort(), action_ref: action.id, payload: { outcome: result.outcome, mode: result.resolutionMode ?? null, represented_hits: result.representedHitCount } });
  }

  for (const reaction of prepared.results.filter((item) => item.outcome === "applied" || item.outcome === "failed")) {
    resourceDeltas.push({ characterId: reaction.reactorId, resource: reaction.resourceCost.resource, delta: -reaction.resourceCost.amount, sourceRef: reaction.id });
    reactionEconomyDeltas.set(reaction.reactorId, (reactionEconomyDeltas.get(reaction.reactorId) ?? 0) + reaction.actionEconomyCost);
    events.push({ type: "reaction_resolved", actor_refs: [reaction.reactorId], target_refs: [], action_ref: reaction.targetActionId, payload: { reaction_id: reaction.id, outcome: reaction.outcome, effect: reaction.effect.kind } });
  }

  const startingSnapshotHash = canonicalHash({ world: snapshot.world, characters: snapshot.characters });
  const transaction = new TurnTransaction({ world: snapshot.world, characters: snapshot.characters, registries: snapshot.registries });
  transaction.stage({
    startingSnapshotHash,
    resourceDeltas,
    actionEconomyDeltas: [...actionEconomyDeltas],
    reactionEconomyDeltas: [...reactionEconomyDeltas],
    movementEconomyDeltas: [...movementEconomyDeltas],
    statusAdditions,
    statusRemovals,
    displacements,
    preCommitConflicts: [],
    events,
    actionRefs: actionResults.map((result) => result.id),
    summaryTags: actionResults.map((result) => result.outcome)
  });
  let committed;
  try {
    committed = transaction.commit(
      (working, staged) => applyTurnCommit(working, staged, engine.config, input.advance_time !== false),
      (result) => validateCommitted(engine, result)
    );
  } catch (error) {
    const aborted = transaction.abort(error instanceof Error ? error.message : String(error));
    return Object.freeze({ outcome: "aborted", reason: aborted.reason, world: snapshot.world, characters: snapshot.characters, actionResults: [], reactionResults: prepared.results, events: [], conflicts: [], trace: input.trace === false ? undefined : { specVersion: engine.config.version, seed: snapshot.seed, startingSnapshotHash, declarations: { actions: snapshot.actions, reactions: prepared.ordered }, validation, reservations: ledger.records(), ordering: orderedActions.map((action) => action.id), reactions: prepared.results, actionResolutions: actionResults, pipeline: ["snapshot", "declaration_validation", "resource_and_economy_reservation", "reaction_opportunities", "action_and_hit_resolution", "secondary_consequences", "simultaneous_merge", "atomic_commit", "aborted"], error: aborted.reason } });
  }
  const trace = {
    specVersion: engine.config.version,
    seed: snapshot.seed,
    startingSnapshotHash,
    declarations: {
      actionHashes: Object.fromEntries(snapshot.actions.map((action) => [action.id, canonicalHash(action)]).sort(([a], [b]) => a.localeCompare(b))),
      reactionHashes: Object.fromEntries(prepared.ordered.map((reaction) => [reaction.id, canonicalHash(reaction)]).sort(([a], [b]) => a.localeCompare(b)))
    },
    validation,
    reservations: ledger.records(),
    ordering: {
      stages: engine.config.specs["combat-loop.yaml"].action_ordering.mechanics_order,
      actionIds: orderedActions.map((action) => action.id),
      finalTieBreaker: "action.id"
    },
    reactions: prepared.results,
    actionResolutions: actionResults,
    merge: {
      stagedDeltas: transaction.staged(),
      resourceChanges: committed.resourceChanges,
      actionEconomyChanges: committed.economyChanges,
      statusChanges: committed.statusChanges,
      displacementChanges: committed.displacementChanges
    },
    conflicts: committed.conflicts,
    commit: { atomic: true, turn: committed.world.turn, advancedTime: input.advance_time !== false },
    resultingSnapshotHash: canonicalHash({ world: committed.world, characters: committed.characters }),
    pipeline: engine.config.specs["combat-loop.yaml"].turn_contract.phases
  };
  const baseResult = {
    outcome: "committed",
    world: committed.world,
    characters: committed.characters,
    actionResults,
    reactionResults: prepared.results,
    events: committed.events,
    conflicts: committed.conflicts
  };
  const resultHash = canonicalHash(mechanicalTurnResult(baseResult));
  const replayInformation = {
    inputHash: canonicalHash({ world: snapshot.world, characters: snapshot.characters, actions: snapshot.actions, reactions: snapshot.reactions, registries: snapshot.registries, seed: snapshot.seed }),
    configurationHash: canonicalHash({ version: engine.config.version, specs: engine.config.specs, schemas: engine.config.schemas }),
    traceHash: canonicalHash(trace),
    resultHash
  };
  return Object.freeze({ ...baseResult, resultHash, replayInformation, trace: input.trace === false ? undefined : trace });
}

function relativeDifference(left, right) {
  const scale = Math.max(Math.abs(left), Math.abs(right), 1e-12);
  return Math.abs(left - right) / scale;
}

function resourceSnapshot(result) {
  return Object.fromEntries(Object.entries(result.characters).sort(([a], [b]) => a.localeCompare(b)).flatMap(([characterId, character]) =>
    Object.entries(character.resources).sort(([a], [b]) => a.localeCompare(b)).map(([resource, state]) => [`${characterId}.${resource}`, state.current])
  ));
}

export function compareBatchEquivalence(engine, input) {
  const batch = engine.resolveTurn({ ...deepClone(input), trace: false, force_individual: false });
  const individual = engine.resolveTurn({ ...deepClone(input), trace: false, force_individual: true });
  if (batch.outcome !== "committed" || individual.outcome !== "committed") throw new ResolutionError("Batch equivalence requires two committed resolutions.");
  const batchDamage = batch.actionResults.reduce((sum, action) => sum + action.healthDamage, 0);
  const individualDamage = individual.actionResults.reduce((sum, action) => sum + action.healthDamage, 0);
  const batchStability = batch.actionResults.reduce((sum, action) => sum + action.stabilityDamage, 0);
  const individualStability = individual.actionResults.reduce((sum, action) => sum + action.stabilityDamage, 0);
  const batchHits = batch.actionResults.reduce((sum, action) => sum + action.representedHitCount, 0);
  const individualHits = individual.actionResults.reduce((sum, action) => sum + action.representedHitCount, 0);
  const batchResources = resourceSnapshot(batch);
  const individualResources = resourceSnapshot(individual);
  const resourceMaximumDifference = Math.max(0, ...Object.keys(batchResources).map((key) => Math.abs(batchResources[key] - individualResources[key])));
  const batchStatuses = Object.values(batch.characters).reduce((sum, character) => sum + character.statuses.length, 0);
  const individualStatuses = Object.values(individual.characters).reduce((sum, character) => sum + character.statuses.length, 0);
  const batchAllocation = batch.actionResults.map((action) => action.targetAllocation ?? []);
  const individualAllocation = individual.actionResults.map((action) => action.targetAllocation ?? []);
  const tolerance = engine.config.specs["attack.yaml"].multi_attack.equivalence_tolerance;
  const divergence = {
    damageRelative: relativeDifference(batchDamage, individualDamage),
    stabilityRelative: relativeDifference(batchStability, individualStability),
    resourceAbsolute: resourceMaximumDifference,
    hitCountAbsolute: Math.abs(batchHits - individualHits),
    statusCountAbsolute: Math.abs(batchStatuses - individualStatuses),
    targetAllocationEqual: stableStringify(batchAllocation) === stableStringify(individualAllocation)
  };
  const withinTolerance = divergence.damageRelative <= coefficient(tolerance.relative_damage)
    && divergence.stabilityRelative <= coefficient(tolerance.relative_stability)
    && divergence.resourceAbsolute <= coefficient(tolerance.resource_absolute)
    && divergence.hitCountAbsolute <= coefficient(tolerance.hit_count_absolute)
    && divergence.statusCountAbsolute <= coefficient(tolerance.status_count_absolute)
    && divergence.targetAllocationEqual;
  const classifiedBatchSafe = batch.actionResults.some((action) => action.resolutionMode === "batch");
  return Object.freeze({
    withinTolerance,
    classifiedBatchSafe,
    validClassification: !classifiedBatchSafe || withinTolerance,
    divergence,
    totals: {
      batch: { damage: batchDamage, stability: batchStability, hits: batchHits, statuses: batchStatuses },
      individual: { damage: individualDamage, stability: individualStability, hits: individualHits, statuses: individualStatuses }
    },
    resultHashes: { batch: batch.resultHash, individual: individual.resultHash }
  });
}
