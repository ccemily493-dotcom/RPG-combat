import { coefficient } from "./config.js";
import { ValidationError } from "./errors.js";
import { immutableEncounterSnapshot } from "./immutable.js";
import { resolveModifiers } from "./modifiers.js";
import { applyMicroVariance } from "./variance.js";
import { ActionTransaction, scaledCost } from "./transaction.js";
import { planMultiAttack } from "./multi.js";
import { canonicalHash, clamp, distance3, lerp, roundTo, weightedMean } from "./utils.js";

const PHYSICAL_DELIVERY = new Set(["melee", "projectile", "contact"]);

export function applyPenetrationToFilter(filterPercent, penetration, compatibility) {
  return clamp(0, 100, filterPercent * (1 - clamp(0, 1, penetration) * clamp(0, 1, compatibility)));
}

export function combineSequentialFilters(activeFilterPercent, bodyFilterPercent) {
  return clamp(0, 1, 1 - (1 - activeFilterPercent / 100) * (1 - bodyFilterPercent / 100));
}

export function receivedNormalPower(power, activeFilterPercent, bodyFilterPercent) {
  return Math.max(0, power) * (1 - combineSequentialFilters(activeFilterPercent, bodyFilterPercent));
}

export function boundedHarmCapacityMultiplier(config, harmCapacity) {
  const conversion = config.specs["damage.yaml"].harm_conversion;
  const ratio = Math.max(0, harmCapacity) / coefficient(conversion.reference_harm_capacity);
  const anchors = conversion.harm_capacity_multiplier.anchors
    .map((anchor) => ({ ratio: coefficient(anchor.capacity_ratio), multiplier: coefficient(anchor.multiplier), label: anchor.label }))
    .sort((a, b) => a.ratio - b.ratio || a.label.localeCompare(b.label));
  if (ratio <= anchors[0].ratio) return Object.freeze({ ratio, multiplier: anchors[0].multiplier, lower: anchors[0], upper: anchors[0] });
  if (ratio >= anchors.at(-1).ratio) return Object.freeze({ ratio, multiplier: anchors.at(-1).multiplier, lower: anchors.at(-1), upper: anchors.at(-1) });
  const upperIndex = anchors.findIndex((anchor) => ratio <= anchor.ratio);
  const lower = anchors[upperIndex - 1];
  const upper = anchors[upperIndex];
  const fraction = (ratio - lower.ratio) / (upper.ratio - lower.ratio);
  return Object.freeze({ ratio, multiplier: roundTo(lerp(lower.multiplier, upper.multiplier, fraction)), lower, upper });
}

export function classifyDefenseEffectiveness(config, filter) {
  const bands = config.specs["defense.yaml"].defense_effectiveness_bands;
  if (filter === bands.perfect.value) return "perfect";
  if (filter === 0) return "failed";
  if (filter <= bands.poor.max) return "poor";
  if (filter <= bands.weak.max) return "weak";
  if (filter <= bands.effective.max) return "effective";
  if (filter <= bands.strong.max) return "strong";
  if (filter <= bands.exceptional.max) return "exceptional";
  return "near_perfect";
}

function modifierLists(snapshot, character) {
  return [snapshot.world.modifiers, character.modifiers, snapshot.action.modifiers];
}

function varianceIdentity(snapshot, seed, component) {
  return {
    seed,
    simulationId: snapshot.world.simulation_id,
    turn: snapshot.world.turn,
    actionId: snapshot.action.id,
    targetId: snapshot.target.id,
    component
  };
}

function vary(value, config, snapshot, seed, component, bounds) {
  return applyMicroVariance(value, config, varianceIdentity(snapshot, seed, component), bounds);
}

function validateNormalizedMechanics(snapshot, config) {
  const action = snapshot.action;
  if (action.kind !== "attack" || !action.attack) throw new ValidationError("The v0.1 vertical slice resolves normalized attack actions only.");
  if (action.turn !== snapshot.world.turn) throw new ValidationError("Action turn must match world turn.");
  if (action.actor_id !== snapshot.actor.id) throw new ValidationError("Action actor_id must match actor snapshot.");
  if (!action.targets.some((target) => target.ref === snapshot.target.id)) throw new ValidationError("Target snapshot must be declared by the action.");
  const shareTotal = Object.values(action.attack.channels).reduce((sum, share) => sum + share, 0);
  const tolerance = config.specs["invariants.yaml"].required_property_tests.batch_conservation.tolerance.value;
  if (Math.abs(shareTotal - 1) > tolerance) throw new ValidationError(`Attack channel shares sum to ${shareTotal}, not 1.`);
}

function resolveOffense(snapshot, config, seed) {
  const attackSpec = config.specs["attack.yaml"];
  const attack = snapshot.action.attack;
  const actorStats = snapshot.actor.resolved_stats;
  const context = { world: snapshot.world, character: snapshot.actor, action: snapshot.action };
  const modifiers = modifierLists(snapshot, snapshot.actor);
  const physical = PHYSICAL_DELIVERY.has(attack.delivery);

  const powerBase = physical
    ? attack.power + actorStats.physical_capability * coefficient(attackSpec.derived_offense.physical_power.physical_weight)
    : Math.min(attack.power, actorStats.energy_output * coefficient(attackSpec.derived_offense.energy_power.output_weight));
  const accuracyDefinition = physical ? attackSpec.derived_offense.physical_accuracy : attackSpec.derived_offense.energy_accuracy;
  const accuracyStat = physical ? actorStats.coordination : actorStats.energy_control;
  const accuracyWeight = physical ? accuracyDefinition.coordination_weight : accuracyDefinition.control_weight;
  const accuracyNumerator = accuracyStat * coefficient(accuracyWeight)
    + actorStats.perception * coefficient(accuracyDefinition.perception_weight);
  const accuracyWeightTotal = coefficient(accuracyWeight) + coefficient(accuracyDefinition.perception_weight);
  const normalizedAccuracyTerm = attackSpec.derived_offense.accuracy_normalization.normalize_opposed_weight_totals
    ? accuracyNumerator / accuracyWeightTotal
    : accuracyNumerator;
  const accuracyBase = attack.accuracy + normalizedAccuracyTerm;

  const resolved = {
    power: resolveModifiers(powerBase, "attack.power", modifiers, context, { clamp: [0, Infinity] }),
    accuracy: resolveModifiers(accuracyBase, "attack.accuracy", modifiers, context, { clamp: [0, 100] }),
    speed: resolveModifiers(attack.speed, "attack.speed", modifiers, context, { clamp: [0, Infinity] }),
    penetration: resolveModifiers(attack.penetration, "attack.penetration", modifiers, context, { clamp: [0, 1] }),
    range: resolveModifiers(attack.range, "attack.range", modifiers, context, { clamp: [0, Infinity] }),
    stabilityImpact: resolveModifiers(attack.stability_impact, "attack.stability_impact", modifiers, context, { clamp: [0, Infinity] })
  };

  const varied = {
    power: vary(resolved.power.finalValue, config, snapshot, seed, "attack.power", [0, Infinity]),
    accuracy: vary(resolved.accuracy.finalValue, config, snapshot, seed, "attack.accuracy", [0, 100]),
    speed: vary(resolved.speed.finalValue, config, snapshot, seed, "attack.speed", [0, Infinity]),
    penetration: vary(resolved.penetration.finalValue, config, snapshot, seed, "attack.penetration", [0, 1]),
    range: vary(resolved.range.finalValue, config, snapshot, seed, "attack.range", [0, Infinity]),
    stabilityImpact: vary(resolved.stabilityImpact.finalValue, config, snapshot, seed, "attack.stability_impact", [0, Infinity])
  };

  return {
    physical,
    selectedStats: physical ? ["physical_capability", "coordination", "perception"] : ["energy_output", "energy_control", "perception"],
    accuracyNormalization: { enabled: attackSpec.derived_offense.accuracy_normalization.normalize_opposed_weight_totals, numerator: accuracyNumerator, weightTotal: accuracyWeightTotal, normalizedTerm: normalizedAccuracyTerm },
    resolved,
    varied
  };
}

function projectedArea(area) {
  const dimensions = area.dimensions ?? {};
  if (area.shape === "sphere") return Math.PI * (dimensions.radius ?? 0) ** 2;
  if (area.shape === "cylinder") return (dimensions.diameter ?? 0) * (dimensions.height ?? 0);
  if (area.shape === "box") return (dimensions.width ?? 0) * (dimensions.height ?? 0);
  if (area.shape === "cone") return Math.PI * (dimensions.radius ?? 0) ** 2;
  if (area.shape === "line") return (dimensions.width ?? 0) * (dimensions.length ?? 0);
  return 0;
}

function resolveGeometry(snapshot, config, offense) {
  const attackSpec = config.specs["attack.yaml"];
  const distance = distance3(snapshot.actor.transform.position, snapshot.target.transform.position);
  const range = offense.varied.range.output;
  const grace = coefficient(attackSpec.geometry.range_edge_grace_fraction);
  const inRange = distance <= range * (1 + grace);
  const area = snapshot.action.attack.area;
  let falloffFactor = 1;
  if (inRange && range > 0) {
    const fraction = distance / range;
    if (area.falloff === "linear") falloffFactor = clamp(0, 1, 1 - fraction);
    if (area.falloff === "inverse_square") {
      const reference = coefficient(attackSpec.geometry.area_target_factor.inverse_square_reference_range_fraction);
      falloffFactor = 1 / (1 + (fraction / reference) ** 2);
    }
    if (area.falloff === "stepped") {
      const fullUntil = coefficient(attackSpec.geometry.area_target_factor.stepped_full_until_range_fraction);
      falloffFactor = fraction <= fullUntil ? 1 : coefficient(attackSpec.geometry.area_target_factor.stepped_outer_factor);
    }
  }
  if (!inRange) falloffFactor = 0;
  const overlapFraction = area.shape === "point" ? coefficient(attackSpec.geometry.area_target_factor.point_hit_overlap) : 1;
  const areaFactor = clamp(0, 1, overlapFraction * falloffFactor);
  const areaDefinition = attackSpec.geometry.area_accuracy_adjustment;
  const areaValue = projectedArea(area);
  const areaAccuracyBonus = Math.min(
    coefficient(areaDefinition.max_bonus),
    Math.log2(1 + areaValue / coefficient(areaDefinition.reference_area)) * coefficient(areaDefinition.per_doubling)
  );
  return { distance, range, inRange, shape: area.shape, falloff: area.falloff, falloffFactor, overlapFraction, areaFactor, projectedArea: areaValue, areaAccuracyBonus };
}

function resolveAccuracy(snapshot, config, offense, geometry) {
  const attackSpec = config.specs["attack.yaml"];
  const evasion = attackSpec.derived_offense.target_evasion;
  const stats = snapshot.target.resolved_stats;
  const evasionNumerator = stats.movement * coefficient(evasion.movement_weight)
    + stats.reaction * coefficient(evasion.reaction_weight)
    + stats.coordination * coefficient(evasion.coordination_weight);
  const evasionWeightTotal = coefficient(evasion.movement_weight) + coefficient(evasion.reaction_weight) + coefficient(evasion.coordination_weight);
  const evasionBase = attackSpec.derived_offense.accuracy_normalization.normalize_opposed_weight_totals
    ? evasionNumerator / evasionWeightTotal
    : evasionNumerator;
  const targetModifiers = modifierLists(snapshot, snapshot.target);
  const context = { world: snapshot.world, character: snapshot.target, action: snapshot.action };
  const targetScore = resolveModifiers(evasionBase, "defense.avoidance", targetModifiers, context, { clamp: [0, 100] });
  const attackScore = clamp(0, 100, offense.varied.accuracy.output + geometry.areaAccuracyBonus);
  const margin = attackScore - targetScore.finalValue;
  const bands = attackSpec.accuracy_filter.quality_bands;
  let quality;
  let exposureFactor;
  if (!geometry.inRange || margin < coefficient(bands.miss.margin_lt)) {
    quality = "miss";
    exposureFactor = coefficient(bands.miss.exposure_factor);
  } else if (margin < coefficient(bands.graze.margin_max_exclusive)) {
    quality = "graze";
    const fraction = (margin - coefficient(bands.graze.margin_min))
      / (coefficient(bands.graze.margin_max_exclusive) - coefficient(bands.graze.margin_min));
    exposureFactor = lerp(coefficient(bands.graze.graze_min), coefficient(bands.graze.graze_max), clamp(0, 1, fraction));
  } else if (margin < coefficient(bands.partial.margin_max_exclusive)) {
    quality = "partial";
    const fraction = (margin - coefficient(bands.partial.margin_min))
      / (coefficient(bands.partial.margin_max_exclusive) - coefficient(bands.partial.margin_min));
    exposureFactor = lerp(coefficient(bands.partial.partial_min), coefficient(bands.partial.partial_max), clamp(0, 1, fraction));
  } else {
    quality = "solid";
    exposureFactor = coefficient(bands.solid.exposure_factor);
  }
  return { attackScore, targetScore, targetNormalization: { enabled: attackSpec.derived_offense.accuracy_normalization.normalize_opposed_weight_totals, numerator: evasionNumerator, weightTotal: evasionWeightTotal, normalizedTerm: evasionBase }, margin, quality, exposureFactor: roundTo(exposureFactor) };
}

function resolveTiming(snapshot, config, offense, geometry) {
  const timing = config.specs["attack.yaml"].speed_timing_filter;
  const context = { world: snapshot.world, character: snapshot.target, action: snapshot.action };
  const modifiers = modifierLists(snapshot, snapshot.target);
  const baseLatency = coefficient(timing.base_latency_ms) - snapshot.target.resolved_stats.reaction * coefficient(timing.reaction_ms_per_point);
  const latencyTrace = resolveModifiers(baseLatency, "defense.response_latency", modifiers, context, { clamp: [coefficient(timing.minimum_latency_ms), Infinity] });
  const arrivalMs = geometry.distance / Math.max(offense.varied.speed.output, coefficient(timing.speed_floor)) * coefficient(timing.milliseconds_per_second);
  const commitmentDelayMs = snapshot.registries.commitment_delays_ms?.[snapshot.target.id] ?? 0;
  const marginMs = arrivalMs - latencyTrace.finalValue - commitmentDelayMs;
  const factor = clamp(
    coefficient(timing.timing_factor.min_factor),
    1,
    coefficient(timing.timing_factor.neutral_factor) + marginMs / coefficient(timing.timing_factor.response_span_ms)
  );
  return { responseLatencyMs: latencyTrace.finalValue, latencyTrace, arrivalMs, commitmentDelayMs, marginMs, factor: roundTo(factor) };
}

function channelWeighted(channels, values, fallback = 0) {
  return Object.entries(channels).reduce((sum, [channel, share]) => sum + share * (values?.[channel] ?? fallback), 0);
}

function resolveDefense(snapshot, config, seed, offense, accuracy, timing, contactPower, transaction) {
  const defenseSpec = config.specs["defense.yaml"];
  const intent = snapshot.action.defense;
  if (!intent || accuracy.exposureFactor === 0) return { attempted: false, feasible: false, reason: intent ? "no_contact" : "not_declared", prePenetrationFilter: 0, filter: 0, filterPercent: 0, costPaid: 0, stabilityLoss: 0, displacement: 0 };
  const method = defenseSpec.methods[intent.method];
  const source = snapshot.registries.defense_sources?.[intent.source_ref];
  if (!method || !source) throw new ValidationError(`Unknown defense method or source: ${intent.method}/${intent.source_ref}`);
  const activeStatusTags = snapshot.target.statuses.flatMap((status) => status.tags ?? []);
  const conscious = snapshot.target.transform.posture !== "incapacitated" || source.automatic === true;
  const sourceAvailable = source.available !== false;
  const deliveryCompatible = method.compatible_delivery.includes(snapshot.action.attack.delivery);
  const reactionAvailable = snapshot.target.action_economy.reaction_available || source.automatic === true;
  const hardFeasible = conscious && sourceAvailable && deliveryCompatible && reactionAvailable;

  const weights = method.primary_stats;
  const relevantStats = weightedMean(Object.entries(weights).map(([stat, weight]) => ({ value: snapshot.target.resolved_stats[stat], weight: weight.value })));
  const baseCapacity = source.base_filter + relevantStats * coefficient(defenseSpec.resolution.step_3_base_capacity.stat_to_filter);
  const context = { world: snapshot.world, character: snapshot.target, action: snapshot.action };
  const hookTrace = resolveModifiers(baseCapacity, "defense.filter", modifierLists(snapshot, snapshot.target), context, { clamp: [0, 100] });
  const execution = clamp(0, 1, coefficient(defenseSpec.resolution.step_5_execution.base_execution)
    + snapshot.target.resolved_stats.coordination * coefficient(defenseSpec.resolution.step_5_execution.coordination_weight)
    + (source.method_skill_bonus ?? 0));
  const prepared = source.prepared === true || activeStatusTags.includes("prepared_defense");
  const timingFactor = clamp(0, 1, timing.factor + (prepared ? coefficient(defenseSpec.resolution.step_6_timing.prepared_bonus) : 0) - (source.commitment_penalty ?? 0));
  const compatibility = channelWeighted(snapshot.action.attack.channels, source.compatibility, coefficient(defenseSpec.resolution.step_7_compatibility.unspecified_channel_default));
  const geometryOverlap = source.geometry_overlap ?? 1;
  const coverage = clamp(0, 1, intent.declared_coverage * geometryOverlap * coefficient(method.coverage_default));
  const stabilityRatio = snapshot.target.resources.stability.current / Math.max(snapshot.target.resources.stability.maximum, coefficient(defenseSpec.resolution.step_9_stability.epsilon));
  const stabilityFactor = Math.max(coefficient(defenseSpec.resolution.step_9_stability.low_stability_floor), clamp(0, 1, stabilityRatio));
  const efficiency = clamp(
    coefficient(defenseSpec.resolution.step_10_cost.min_efficiency),
    coefficient(defenseSpec.resolution.step_10_cost.max_efficiency),
    coefficient(defenseSpec.resolution.step_10_cost.base_efficiency) + snapshot.target.resolved_stats.energy_efficiency * coefficient(defenseSpec.resolution.step_10_cost.per_stat)
  );
  const requiredCost = intent.cost.amount / efficiency;
  let resourceFeasible = true;
  if (hardFeasible) {
    try {
      transaction.reserve("target", intent.cost.resource, requiredCost, "defense");
    } catch {
      resourceFeasible = false;
    }
  }
  const feasible = hardFeasible && resourceFeasible;
  const paidFraction = feasible ? 1 : 0;
  const compositionSpec = defenseSpec.composition;
  const weightsSpec = compositionSpec.weighted_performance;
  const contributions = {
    execution: execution * coefficient(weightsSpec.execution_weight),
    timing: timingFactor * coefficient(weightsSpec.timing_weight),
    compatibility: compatibility * coefficient(weightsSpec.compatibility_weight),
    coverage: coverage * coefficient(weightsSpec.coverage_weight)
  };
  const weightedPerformance = Object.values(contributions).reduce((sum, value) => sum + value, 0);
  const boundedStability = clamp(
    coefficient(compositionSpec.bounded_multipliers.stability_minimum),
    coefficient(compositionSpec.bounded_multipliers.stability_maximum),
    stabilityFactor
  );
  const applicabilityGates = {
    feasibility: feasible,
    nonzeroCompatibility: compatibility > 0,
    nonzeroCoverage: coverage > 0,
    paidCost: paidFraction > 0
  };
  const gate = Object.values(applicabilityGates).every(Boolean) ? 1 : 0;
  const prePenetrationFilter = clamp(0, 100, gate * hookTrace.finalValue * weightedPerformance * boundedStability * paidFraction);
  const penetrationCompatibility = typeof source.penetration_compatibility === "number"
    ? source.penetration_compatibility
    : channelWeighted(snapshot.action.attack.channels, source.penetration_compatibility, 1);
  const afterPenetration = applyPenetrationToFilter(prePenetrationFilter, offense.varied.penetration.output, penetrationCompatibility);
  const variance = vary(afterPenetration, config, snapshot, seed, "defense.filter", [0, 100]);
  const filterPercent = feasible ? (afterPenetration === 100 ? 100 : variance.output) : 0;
  const effectivenessBand = classifyDefenseEffectiveness(config, filterPercent / 100);
  const absorbedPower = contactPower * filterPercent / 100;
  const stabilityLoss = Math.max(0, absorbedPower * coefficient(defenseSpec.secondary_consequences.stability_loss.method_stability_transfer) - (source.stability_capacity ?? 0));
  const incomingMomentum = snapshot.action.extension_payload?.["core:incoming_momentum"] ?? 0;
  const displacement = Math.max(0, incomingMomentum - (source.anchor_capacity ?? Infinity))
    * coefficient(defenseSpec.secondary_consequences.displacement.displacement_per_impulse);

  if (feasible) {
    transaction.debit("target", intent.cost.resource, requiredCost, "defense");
    if (!source.automatic) transaction.consumeAction("target", true);
  }
  return {
    attempted: true,
    feasible,
    hardChecks: { conscious, sourceAvailable, deliveryCompatible, reactionAvailable, resourceFeasible },
    method: intent.method,
    how: method.how,
    sourceRef: intent.source_ref,
    selectedStats: Object.keys(weights),
    relevantStats,
    baseCapacity,
    hookTrace,
    execution,
    timing: timingFactor,
    compatibility,
    coverage,
    stabilityFactor,
    efficiency,
    requiredCost,
    paidFraction,
    composition: {
      model: "weighted",
      capacity: hookTrace.finalValue / 100,
      weights: {
        execution: coefficient(weightsSpec.execution_weight),
        timing: coefficient(weightsSpec.timing_weight),
        compatibility: coefficient(weightsSpec.compatibility_weight),
        coverage: coefficient(weightsSpec.coverage_weight)
      },
      contributions,
      weightedPerformance,
      applicabilityGates,
      gate,
      rawStability: stabilityFactor,
      boundedStability,
      resultBeforePenetration: prePenetrationFilter / 100
    },
    prePenetrationFilter,
    penetration: offense.varied.penetration.output,
    penetrationCompatibility,
    variance,
    filter: filterPercent / 100,
    filterPercent,
    effectivenessBand,
    costPaid: feasible ? requiredCost : 0,
    absorbedPower,
    stabilityLoss,
    displacement
  };
}

function selectZone(target, action) {
  const aimed = action.targets.find((candidate) => candidate.ref === target.id)?.body_zone;
  if (aimed && target.body_zones.some((zone) => zone.id === aimed)) return target.body_zones.find((zone) => zone.id === aimed);
  return target.body_zones.find((zone) => zone.id === "core") ?? [...target.body_zones].sort((a, b) => a.id.localeCompare(b.id))[0];
}

function isImmune(target, channel) {
  return target.statuses.some((status) => (status.tags ?? []).includes(`immunity:${channel}`));
}

function resolveDamage(snapshot, config, offense, accuracy, geometry, defense) {
  const damageSpec = config.specs["damage.yaml"];
  const attack = snapshot.action.attack;
  const zone = selectZone(snapshot.target, snapshot.action);
  const contactPower = offense.varied.power.output * accuracy.exposureFactor * geometry.areaFactor;
  const channels = [];
  let zoneHarm = 0;
  for (const [channel, share] of Object.entries(attack.channels).sort(([a], [b]) => a.localeCompare(b))) {
    const immunity = isImmune(snapshot.target, channel);
    const baseBodyFilter = clamp(
      0,
      coefficient(damageSpec.intrinsic_body_filter.max_body_filter),
      (zone.resistance[channel] ?? 0) + snapshot.target.resolved_stats.resistance * coefficient(damageSpec.intrinsic_body_filter.resistance_weight)
    );
    const bodyPenetrationCompatibility = snapshot.registries.body_penetration_compatibility?.[channel] ?? 1;
    const bodyAfterPenetration = applyPenetrationToFilter(baseBodyFilter, offense.varied.penetration.output, bodyPenetrationCompatibility);
    const activeAfterPenetration = defense.filterPercent;
    const combinedFilter = combineSequentialFilters(activeAfterPenetration, bodyAfterPenetration);
    const residualPower = immunity ? 0 : contactPower * share * (1 - combinedFilter);
    const conversion = coefficient(damageSpec.harm_conversion.channel_coefficients[channel] ?? damageSpec.harm_conversion.channel_coefficients.exotic);
    const vulnerability = clamp(
      coefficient(damageSpec.harm_conversion.min_vulnerability),
      coefficient(damageSpec.harm_conversion.max_vulnerability),
      zone.vulnerability[channel] ?? 1
    );
    const harm = residualPower * conversion * vulnerability;
    zoneHarm += harm;
    channels.push({ channel, share, immunity, baseBodyFilter, bodyPenetrationCompatibility, bodyAfterPenetration, activeAfterPenetration, combinedFilter, residualPower, conversion, vulnerability, harm });
  }
  const capacity = boundedHarmCapacityMultiplier(config, snapshot.target.harm_capacity);
  const capacityScale = capacity.ratio;
  let healthDamage = zoneHarm * capacity.multiplier;
  if (healthDamage < coefficient(damageSpec.harm_conversion.minimum_recorded_damage)) healthDamage = 0;
  healthDamage = roundTo(healthDamage, coefficient(damageSpec.harm_conversion.rounding_decimals));
  const weightedCombinedFilter = channels.reduce((sum, channel) => sum + channel.share * channel.combinedFilter, 0);
  const stabilityDamage = roundTo(
    offense.varied.stabilityImpact.output * accuracy.exposureFactor * (1 - weightedCombinedFilter)
      + defense.stabilityLoss
      + healthDamage * coefficient(damageSpec.stability_damage.health_to_stability_transfer),
    coefficient(damageSpec.harm_conversion.rounding_decimals)
  );
  return { zoneId: zone.id, contactPower, channels, zoneHarm, capacityScale, harmCapacityMultiplier: capacity, healthDamage, weightedCombinedFilter, stabilityDamage };
}

function resolveStatuses(snapshot, config, accuracy, damage) {
  const statusSpec = config.specs["damage.yaml"].status_effects;
  if (accuracy.exposureFactor === 0) return [];
  return snapshot.action.attack.status_effects.map((attempt) => {
    const definition = snapshot.registries.status_definitions?.[attempt.status_id];
    if (!definition) throw new ValidationError(`Unknown status definition: ${attempt.status_id}`);
    const immune = definition.channel ? isImmune(snapshot.target, definition.channel) : false;
    const context = { world: snapshot.world, character: snapshot.target, action: snapshot.action };
    const baseThreshold = coefficient(statusSpec.base_threshold) + snapshot.target.resolved_stats.resistance * coefficient(statusSpec.stat_weight);
    const thresholdTrace = resolveModifiers(baseThreshold, `status.resistance.${attempt.status_id}`, modifierLists(snapshot, snapshot.target), context, { clamp: [0, Infinity] });
    const potency = attempt.potency * accuracy.exposureFactor;
    const margin = potency - thresholdTrace.finalValue;
    let outcome = "resisted";
    let durationTurns = 0;
    if (!immune && margin >= coefficient(statusSpec.bands.full_at_or_above)) {
      outcome = "full";
      durationTurns = attempt.duration_turns;
    } else if (!immune && margin >= coefficient(statusSpec.bands.resisted_below)) {
      outcome = "partial";
      durationTurns = Math.round(attempt.duration_turns * coefficient(statusSpec.partial_duration_factor));
    }
    return { ...attempt, stacking_rule: definition.merge_policy, definition, immune, potency, thresholdTrace, margin, outcome, durationTurns, damageZone: damage.zoneId };
  });
}

function actorCostPlan(action) {
  const durationSeconds = action.timing?.duration_seconds ?? 1;
  const targetCount = action.targets.length;
  return action.costs.map((cost) => ({ ...cost, scaledAmount: scaledCost(cost, { durationSeconds, targetCount }) }));
}

function updateWorld(snapshot, action, outcome, traceHash) {
  return (world, mutations) => {
    const resourceDeltas = mutations
      .filter((mutation) => mutation.type === "resource" || mutation.type === "health" || mutation.type === "stability")
      .map((mutation) => ({ character_id: mutation.characterId, resource: mutation.resource ?? mutation.type, delta: mutation.delta }));
    world.previous_turn = {
      turn: snapshot.world.turn,
      snapshot_hash: canonicalHash(snapshot),
      action_refs: [action.id],
      events: [{ sequence: 0, type: "attack_resolved", actor_refs: [snapshot.actor.id], target_refs: [snapshot.target.id], action_ref: action.id, payload: { outcome, trace_hash: traceHash } }],
      resource_deltas: resourceDeltas,
      created_modifier_ids: [],
      expired_modifier_ids: [],
      summary_tags: [outcome]
    };
    world.turn += 1;
    world.time.elapsed_seconds = roundTo(world.time.elapsed_seconds + (action.timing?.duration_seconds ?? world.time.turn_duration_seconds));
    return world;
  };
}

export function resolveEncounter(config, schemas, input) {
  schemas.validate("world", input.world);
  schemas.validate("character", input.actor);
  schemas.validate("character", input.target);
  schemas.validate("action", input.action);
  schemas.validate("defenseSources", input.registries?.defense_sources ?? {});
  schemas.validate("statusDefinitions", input.registries?.status_definitions ?? {});
  const snapshot = immutableEncounterSnapshot(input);
  validateNormalizedMechanics(snapshot, config);
  const seed = String(input.seed);
  const transaction = new ActionTransaction(snapshot);
  const costPlan = actorCostPlan(snapshot.action);
  try {
    for (const cost of costPlan) transaction.reserve("actor", cost.resource, cost.scaledAmount, `action:${cost.timing}`);
  } catch (error) {
    const aborted = transaction.abort(error.message);
    return Object.freeze({ ...aborted, outcome: "invalid", reason: "insufficient_resources", error, trace: input.trace === false ? undefined : { pipeline: ["validate_and_snapshot", "reserve_costs", "aborted"], error: error.message } });
  }

  const offense = resolveOffense(snapshot, config, seed);
  const multiAttack = planMultiAttack(config, snapshot.action.attack.quantity ?? 1, offense.varied.power.output,
    Object.fromEntries(costPlan.map((cost) => [cost.resource, cost.scaledAmount])));
  if (multiAttack.quantity !== 1) {
    throw new ValidationError("The executable encounter vertical slice accepts quantity=1; planMultiAttack provides deterministic individual/batch partitioning for the next combat-loop phase.");
  }
  const geometry = resolveGeometry(snapshot, config, offense);
  const accuracy = resolveAccuracy(snapshot, config, offense, geometry);
  const timing = resolveTiming(snapshot, config, offense, geometry);
  const contactPower = offense.varied.power.output * accuracy.exposureFactor * geometry.areaFactor;
  const defense = resolveDefense(snapshot, config, seed, offense, accuracy, timing, contactPower, transaction);
  const damage = resolveDamage(snapshot, config, offense, accuracy, geometry, defense);
  const statuses = resolveStatuses(snapshot, config, accuracy, damage);

  for (const cost of costPlan) {
    const contactRequired = cost.timing === "on_contact";
    if (!contactRequired || accuracy.exposureFactor > 0) transaction.debit("actor", cost.resource, cost.scaledAmount, `action:${cost.timing}`);
  }
  transaction.consumeAction("actor", false);
  transaction.damage("target", damage.healthDamage, "resolved_damage");
  transaction.destabilize("target", damage.stabilityDamage, "resolved_stability");
  for (const status of statuses) {
    if (status.outcome === "resisted" || status.durationTurns === 0) continue;
    transaction.addStatus("target", {
      id: status.status_id,
      source_ref: snapshot.action.id,
      intensity: roundTo(status.potency),
      remaining_turns: status.durationTurns,
      stacking_rule: status.stacking_rule,
      tags: status.definition.tags ?? []
    });
  }

  const outcome = accuracy.quality === "miss" ? "failure" : accuracy.quality === "solid" ? "success" : "partial";
  const trace = {
    specVersion: config.version,
    seed,
    inputHashes: {
      world: canonicalHash(snapshot.world), actor: canonicalHash(snapshot.actor), target: canonicalHash(snapshot.target), action: canonicalHash(snapshot.action), registries: canonicalHash(snapshot.registries)
    },
    pipeline: ["validate_and_snapshot", "reserve_costs", "target_and_geometry", "accuracy_filter", "speed_timing_filter", "defense_resolution", "penetration_application", "damage_and_secondary_effects", "commit_costs_and_state", "emit_audit_record"],
    offense,
    multiAttack,
    geometry,
    accuracy,
    timing,
    defense,
    damage,
    statuses,
    outcome
  };
  const traceHash = canonicalHash(trace);
  const committed = transaction.commit(updateWorld(snapshot, snapshot.action, outcome, traceHash));
  schemas.validate("world", committed.world);
  schemas.validate("character", committed.actor);
  schemas.validate("character", committed.target);
  const completedTrace = { ...trace, stateMutations: committed.mutations, outputHashes: { world: canonicalHash(committed.world), actor: canonicalHash(committed.actor), target: canonicalHash(committed.target) } };

  return Object.freeze({
    outcome,
    quality: accuracy.quality,
    healthDamage: damage.healthDamage,
    stabilityDamage: damage.stabilityDamage,
    defenseFilter: defense.filter,
    defenseFilterPercent: defense.filterPercent,
    traceHash: canonicalHash(completedTrace),
    trace: input.trace === false ? undefined : completedTrace,
    ...committed
  });
}
