import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { summarize } from "./statistics.js";

function configured(node) {
  return node.value;
}

export async function loadBenchmarkAssets(specDir) {
  const [fixture, harness, generatedProfiles] = await Promise.all([
    readFile(join(specDir, "fixtures", "reference-encounter.json"), "utf8").then(JSON.parse),
    readFile(join(specDir, "fixtures", "simulation-config.json"), "utf8").then(JSON.parse),
    readFile(join(specDir, "fixtures", "specialized-benchmark-profiles.json"), "utf8").then(JSON.parse)
  ]);
  return { fixture, harness, generatedProfiles };
}

export function profileIndex(generatedProfiles) {
  return new Map(generatedProfiles.profiles.map((profile) => [profile.id, profile]));
}

function applyProfile(character, profile, config, harness, position) {
  const result = structuredClone(character);
  result.id = character.id;
  result.name = profile.id;
  result.category_profile = { default_category: profile.category, per_stat: {} };
  result.resolved_stats = structuredClone(profile.resolved_stats);
  const resources = harness.resources;
  result.resources = {
    health: { current: configured(resources.health), maximum: configured(resources.health) },
    stability: { current: configured(resources.stability), maximum: configured(resources.stability) },
    energy: { current: configured(resources.energy), maximum: configured(resources.energy) }
  };
  const harm = config.specs["stats.yaml"].derived_value_rules.harm_capacity;
  result.harm_capacity = configured(harm.base) + result.resolved_stats.resistance * configured(harm.per_stat);
  result.transform.position = { x: position, y: 0, z: 0 };
  result.transform.velocity = { x: 0, y: 0, z: 0 };
  result.transform.posture = "standing";
  result.body_zones = [{
    id: "core",
    allocation_weight: 1,
    resistance: { kinetic: configured(harness.body.kinetic_resistance) },
    vulnerability: { kinetic: configured(harness.body.kinetic_vulnerability) },
    disabled: false,
    tags: []
  }];
  result.statuses = [];
  result.modifiers = [];
  result.action_economy = {
    available: true, reaction_available: true, committed_until_turn: 0,
    action_capacity: 1, actions_remaining: 1, actions_reserved: 0,
    reaction_capacity: 1, reactions_remaining: 1, reactions_reserved: 0
  };
  result.cooldowns = {};
  result.inventory_refs = ["shield.benchmark"];
  result.tags = [profile.specialization];
  result.extension_state = {};
  return result;
}

export function buildBenchmarkEncounter({ config, assets, attackerProfile, defenderProfile, seed, trace = true, actorStatOverrides = {}, targetStatOverrides = {} }) {
  const { fixture, harness } = assets;
  const distance = configured(harness.attack.distance);
  const actor = applyProfile(fixture.actor, attackerProfile, config, harness, 0);
  const target = applyProfile(fixture.target, defenderProfile, config, harness, distance);
  Object.assign(actor.resolved_stats, actorStatOverrides);
  Object.assign(target.resolved_stats, targetStatOverrides);
  const harm = config.specs["stats.yaml"].derived_value_rules.harm_capacity;
  actor.harm_capacity = configured(harm.base) + actor.resolved_stats.resistance * configured(harm.per_stat);
  target.harm_capacity = configured(harm.base) + target.resolved_stats.resistance * configured(harm.per_stat);

  const world = structuredClone(fixture.world);
  world.simulation_id = `calibration:${attackerProfile.id}:${defenderProfile.id}`;
  world.modifiers = [];
  const action = structuredClone(fixture.action);
  action.id = "calibration-strike";
  action.modifiers = [];
  action.attack.power = configured(harness.attack.base_power);
  action.attack.accuracy = configured(harness.attack.base_accuracy);
  action.attack.speed = actor.resolved_stats.movement * configured(harness.attack.speed_per_movement);
  action.attack.penetration = configured(harness.attack.penetration);
  action.attack.range = configured(harness.attack.range);
  action.attack.stability_impact = configured(harness.attack.stability_impact);
  action.attack.channels = { kinetic: 1 };
  action.attack.status_effects = [];
  action.attack.quantity = 1;
  action.attack.targeting = { mode: "SINGLE", allocations: [] };
  action.attack.interrupt_resistance = 0;
  action.attack.batch_safety = "AUTO";
  action.costs = [{ resource: "energy", amount: configured(harness.attack.energy_cost), timing: "on_attempt", mode: "PER_ACTION" }];
  action.defense.source_ref = "shield.benchmark";
  action.defense.declared_coverage = configured(harness.defense_source.coverage);
  action.defense.cost.amount = configured(harness.defense_source.energy_cost);
  action.defense.cost.mode = "PER_ACTION";
  action.extension_payload = {};
  return {
    world,
    actor,
    target,
    action,
    seed,
    trace,
    registries: {
      defense_sources: {
        "shield.benchmark": {
          available: true,
          automatic: false,
          base_filter: configured(harness.defense_source.base_filter),
          compatibility: { kinetic: configured(harness.defense_source.kinetic_compatibility) },
          penetration_compatibility: configured(harness.defense_source.penetration_compatibility),
          geometry_overlap: 1,
          method_skill_bonus: 0,
          commitment_penalty: 0,
          stability_capacity: configured(harness.defense_source.stability_capacity)
        }
      },
      body_penetration_compatibility: { kinetic: 1 },
      status_definitions: {},
      commitment_delays_ms: { [target.id]: 0 }
    }
  };
}

export function runCohort(engine, encounterOptions, repeats, seedPrefix) {
  const results = [];
  for (let index = 0; index < repeats; index += 1) {
    results.push(engine.resolveEncounter(buildBenchmarkEncounter({ ...encounterOptions, config: engine.config, seed: `${seedPrefix}:${index}` })));
  }
  return results;
}

export function summarizeCohort(results) {
  const qualities = { miss: 0, graze: 0, partial: 0, solid: 0 };
  for (const result of results) qualities[result.quality] += 1;
  return {
    count: results.length,
    qualities: Object.fromEntries(Object.entries(qualities).map(([id, count]) => [id, count / results.length])),
    accuracyMargin: summarize(results.map((result) => result.trace.accuracy.margin)),
    healthDamage: summarize(results.map((result) => result.healthDamage)),
    stabilityDamage: summarize(results.map((result) => result.stabilityDamage)),
    activeDefenseFilter: summarize(results.map((result) => result.defenseFilter))
  };
}

function measured(iterations, fn) {
  const times = [];
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const itemStarted = performance.now();
    fn(index);
    times.push(performance.now() - itemStarted);
  }
  const elapsedMs = performance.now() - started;
  return { iterations, elapsedMs, operationsPerSecond: iterations / (elapsedMs / 1000), latencyMs: summarize(times) };
}

function measuredPair(iterations, firstFn, secondFn) {
  const firstTimes = [];
  const secondTimes = [];
  for (let index = 0; index < iterations; index += 1) {
    const order = index % 2 === 0 ? [[firstFn, firstTimes], [secondFn, secondTimes]] : [[secondFn, secondTimes], [firstFn, firstTimes]];
    for (const [fn, times] of order) {
      const started = performance.now();
      fn(index);
      times.push(performance.now() - started);
    }
  }
  const result = (times) => {
    const elapsedMs = times.reduce((sum, value) => sum + value, 0);
    return { iterations, elapsedMs, operationsPerSecond: iterations / (elapsedMs / 1000), latencyMs: summarize(times) };
  };
  return { first: result(firstTimes), second: result(secondTimes) };
}

export function benchmarkPerformance(engine, baseInput, iterations = 500) {
  for (let index = 0; index < 32; index += 1) engine.resolveEncounter({ ...structuredClone(baseInput), seed: `warmup:${index}`, trace: false });
  const paired = measuredPair(
    iterations,
    (index) => engine.resolveEncounter({ ...structuredClone(baseInput), seed: `perf:paired:${index}`, trace: false }),
    (index) => engine.resolveEncounter({ ...structuredClone(baseInput), seed: `perf:paired:${index}`, trace: true })
  );
  const noTrace = paired.first;
  const withTrace = paired.second;
  const schemaValidation = measured(iterations, () => {
    engine.schemas.validate("world", baseInput.world);
    engine.schemas.validate("character", baseInput.actor);
    engine.schemas.validate("character", baseInput.target);
    engine.schemas.validate("action", baseInput.action);
  });
  const observedTraceDelta = withTrace.latencyMs.median - noTrace.latencyMs.median;
  return {
    noTrace,
    withTrace,
    schemaValidation,
    tracingMedianOverheadMs: Math.max(0, observedTraceDelta),
    tracingObservedMedianDeltaMs: observedTraceDelta,
    schemaMedianShareOfResolution: schemaValidation.latencyMs.median / noTrace.latencyMs.median,
    note: "Trace-on and trace-off samples are alternated with identical seeds. The engine always constructs the canonical mechanical audit needed for replay; trace=false suppresses return payload only. A negative observed delta is measurement noise and is reported as zero overhead."
  };
}
