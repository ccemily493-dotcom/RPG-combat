import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createDefaultEngine } from "../src/index.js";

const engine = await createDefaultEngine();
const fixture = JSON.parse(await readFile(join(engine.config.specDir, "fixtures", "reference-encounter.json"), "utf8"));
const harness = JSON.parse(await readFile(join(engine.config.specDir, "fixtures", "simulation-config.json"), "utf8"));
const categories = engine.config.specs["categories.yaml"].categories;
const iterationsArgument = process.argv.find((value) => /^--iterations=\d+$/.test(value));
const iterations = iterationsArgument ? Number(iterationsArgument.split("=")[1]) : harness.iterations_per_matchup.value;
const matchups = [
  ["civilian", "civilian"],
  ["fighter", "civilian"],
  ["fighter", "fighter"],
  ["elite", "fighter"],
  ["legendary", "civilian"]
];

function value(node) { return node.value; }

function genericCharacter(id, category, x) {
  const stat = categories[category].default.value;
  const resource = harness.resources;
  return {
    id,
    name: `${category}:${id}`,
    category_profile: { default_category: category, per_stat: {} },
    resolved_stats: {
      physical_capability: stat, movement: stat, reaction: stat, coordination: stat,
      resistance: stat, perception: stat, strategy: stat, energy_capacity: stat,
      energy_output: stat, energy_control: stat, energy_efficiency: stat
    },
    resources: {
      health: { current: value(resource.health), maximum: value(resource.health) },
      stability: { current: value(resource.stability), maximum: value(resource.stability) },
      energy: { current: value(resource.energy), maximum: value(resource.energy) }
    },
    harm_capacity: engine.config.specs["stats.yaml"].derived_value_rules.harm_capacity.base.value
      + stat * engine.config.specs["stats.yaml"].derived_value_rules.harm_capacity.per_stat.value,
    transform: {
      position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      facing: { x: id === "attacker" ? 1 : -1, y: 0, z: 0 }, posture: "standing"
    },
    body_zones: [{
      id: "core", allocation_weight: 1,
      resistance: { kinetic: value(harness.body.kinetic_resistance) },
      vulnerability: { kinetic: value(harness.body.kinetic_vulnerability) },
      disabled: false, tags: []
    }],
    statuses: [], modifiers: [],
    action_economy: { available: true, reaction_available: true, committed_until_turn: 0 },
    cooldowns: {}, inventory_refs: ["shield.benchmark"], tags: [], extension_state: {}
  };
}

function encounter(attackerCategory, defenderCategory, seed) {
  const attacker = genericCharacter("attacker", attackerCategory, 0);
  const defender = genericCharacter("defender", defenderCategory, value(harness.attack.distance));
  const world = structuredClone(fixture.world);
  world.simulation_id = `benchmark:${attackerCategory}:${defenderCategory}`;
  world.modifiers = [];
  const action = structuredClone(fixture.action);
  action.id = `benchmark-strike`;
  action.modifiers = [];
  action.attack.power = value(harness.attack.base_power);
  action.attack.accuracy = value(harness.attack.base_accuracy);
  action.attack.speed = attacker.resolved_stats.movement * value(harness.attack.speed_per_movement);
  action.attack.penetration = value(harness.attack.penetration);
  action.attack.range = value(harness.attack.range);
  action.attack.stability_impact = value(harness.attack.stability_impact);
  action.attack.channels = { kinetic: 1 };
  action.attack.status_effects = [];
  action.costs = [{ resource: "energy", amount: value(harness.attack.energy_cost), timing: "on_attempt" }];
  action.defense.source_ref = "shield.benchmark";
  action.defense.declared_coverage = value(harness.defense_source.coverage);
  action.defense.cost.amount = value(harness.defense_source.energy_cost);
  action.extension_payload = {};
  return {
    world, actor: attacker, target: defender, action, seed, trace: false,
    registries: {
      defense_sources: {
        "shield.benchmark": {
          available: true, automatic: false,
          base_filter: value(harness.defense_source.base_filter),
          compatibility: { kinetic: value(harness.defense_source.kinetic_compatibility) },
          penetration_compatibility: value(harness.defense_source.penetration_compatibility),
          geometry_overlap: 1, method_skill_bonus: 0, commitment_penalty: 0,
          stability_capacity: value(harness.defense_source.stability_capacity)
        }
      },
      body_penetration_compatibility: { kinetic: 1 },
      status_definitions: {}, commitment_delays_ms: { defender: 0 }
    }
  };
}

const started = performance.now();
const results = [];
let invariantViolations = 0;
for (const [attackerCategory, defenderCategory] of matchups) {
  const qualities = { miss: 0, graze: 0, partial: 0, solid: 0 };
  let damage = 0;
  let stability = 0;
  let defenseFilter = 0;
  let minimumDamage = Infinity;
  let maximumDamage = -Infinity;
  for (let index = 0; index < iterations; index += 1) {
    const result = engine.resolveEncounter(encounter(attackerCategory, defenderCategory, `simulation:${index}`));
    qualities[result.quality] += 1;
    damage += result.healthDamage;
    stability += result.stabilityDamage;
    defenseFilter += result.defenseFilter;
    minimumDamage = Math.min(minimumDamage, result.healthDamage);
    maximumDamage = Math.max(maximumDamage, result.healthDamage);
    if (result.defenseFilter < 0 || result.defenseFilter > 1) invariantViolations += 1;
  }
  results.push({
    matchup: `${attackerCategory} vs ${defenderCategory}`,
    iterations,
    qualityDistribution: Object.fromEntries(Object.entries(qualities).map(([key, count]) => [key, count / iterations])),
    averageHealthDamage: damage / iterations,
    minimumHealthDamage: minimumDamage,
    maximumHealthDamage: maximumDamage,
    averageStabilityDamage: stability / iterations,
    averageDefenseFilter: defenseFilter / iterations
  });
}
const elapsedMs = performance.now() - started;
const totalEncounters = iterations * matchups.length;
const suspicious = [];
for (const result of results) {
  const occupiedBands = Object.values(result.qualityDistribution).filter((fraction) => fraction > 0).length;
  if (occupiedBands === 1) suspicious.push(`${result.matchup}: all attacks occupy one accuracy band; expected with ±1% variance, but balance is threshold-sensitive.`);
  if (result.averageDefenseFilter < 0.15) suspicious.push(`${result.matchup}: average active defense filters under the provisional 15% diagnostic floor; inspect the weighted components and gates.`);
  if (result.averageHealthDamage >= value(harness.resources.health)) suspicious.push(`${result.matchup}: average attack is immediately incapacitating.`);
}
if (invariantViolations) suspicious.push(`${invariantViolations} defense-filter bound violations detected.`);

const report = {
  generatedAt: new Date().toISOString(),
  rulesetVersion: engine.config.version,
  seedScheme: "simulation:<iteration>",
  totalEncounters,
  iterationsPerMatchup: iterations,
  elapsedMs,
  encountersPerSecond: totalEncounters / (elapsedMs / 1000),
  invariantViolations,
  assumptions: [
    "Benchmark characters intentionally use their category default for every stat as neutral baselines; this is not a character-generation rule.",
    "Every target declares the same generic block defense and every attack is a normalized kinetic projectile.",
    "Only micro-variance changes between iterations; no tactical AI or action-selection randomness is present."
  ],
  results,
  suspicious
};

const reportDir = join(engine.config.specDir, "reports");
await mkdir(reportDir, { recursive: true });
await writeFile(join(reportDir, "simulation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdown = [
  "# v0.2 Legacy Neutral Simulation Report",
  "",
  `- Encounters: ${totalEncounters.toLocaleString("en-US")}`,
  `- Runtime: ${elapsedMs.toFixed(2)} ms`,
  `- Throughput: ${report.encountersPerSecond.toFixed(0)} encounters/second`,
  `- Invariant violations: ${invariantViolations}`,
  "",
  "| Matchup | Miss | Graze | Partial | Solid | Avg damage | Avg stability | Avg defense |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...results.map((result) => `| ${result.matchup} | ${(result.qualityDistribution.miss * 100).toFixed(1)}% | ${(result.qualityDistribution.graze * 100).toFixed(1)}% | ${(result.qualityDistribution.partial * 100).toFixed(1)}% | ${(result.qualityDistribution.solid * 100).toFixed(1)}% | ${result.averageHealthDamage.toFixed(2)} | ${result.averageStabilityDamage.toFixed(2)} | ${(result.averageDefenseFilter * 100).toFixed(2)}% |`),
  "",
  "## Suspicious distributions",
  "",
  ...(suspicious.length ? suspicious.map((item) => `- ${item}`) : ["- None detected by the provisional heuristics."]),
  "",
  "## Harness assumptions",
  "",
  ...report.assumptions.map((item) => `- ${item}`),
  ""
].join("\n");
await writeFile(join(reportDir, "simulation-report.md"), markdown, "utf8");
console.log(JSON.stringify({ totalEncounters, elapsedMs, encountersPerSecond: report.encountersPerSecond, invariantViolations, suspicious: suspicious.length }, null, 2));
