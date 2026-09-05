import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTuningOverrides,
  buildBenchmarkEncounter,
  cartesianSweep,
  createEngine,
  evaluateBalanceExpectations,
  evaluateDefenseModels,
  generateSpecializedProfiles,
  loadBenchmarkAssets,
  loadDefenseCompositionProfiles,
  loadProfileTemplates,
  microVariance,
  profileIndex,
  runParameterSweep,
  sweepToCsv,
  validateSpecializedProfiles
} from "../src/index.js";
import { clone, loadFixture } from "./helpers.js";

test("specialized fixtures cover eight profiles in all six categories and remain in range", async () => {
  const { engine } = await loadFixture();
  const templates = await loadProfileTemplates(engine.config.specDir);
  const generated = generateSpecializedProfiles(engine.config, templates);
  assert.equal(generated.categoryCount, 6);
  assert.equal(generated.specializationsPerCategory, 8);
  assert.equal(generated.profiles.length, 48);
  assert.deepEqual(validateSpecializedProfiles(engine.config, generated), { ok: true, issues: [] });
  for (const category of templates.applicable_categories) {
    assert.equal(generated.profiles.filter((profile) => profile.category === category).length, 8);
  }
});

test("tuning overrides are immutable, authorized, and leave canonical config unchanged", async () => {
  const { engine } = await loadFixture();
  const pointer = "attack.yaml#/derived_offense/physical_power/physical_weight/value";
  const canonical = engine.config.specs["attack.yaml"].derived_offense.physical_power.physical_weight.value;
  const variant = applyTuningOverrides(engine.config, [{ pointer, value: canonical + 0.1 }]);
  assert.equal(engine.config.specs["attack.yaml"].derived_offense.physical_power.physical_weight.value, canonical);
  assert.equal(variant.specs["attack.yaml"].derived_offense.physical_power.physical_weight.value, canonical + 0.1);
  assert.ok(Object.isFrozen(variant));
  assert.throws(() => applyTuningOverrides(engine.config, [{ pointer: "attack.yaml#/micro_variance/minimum_factor/value", value: 0.5 }]));
});

test("one- and two-dimensional Cartesian sweeps are deterministic", () => {
  const dimensions = [
    { pointer: "a#/x/value", values: [1, 2] },
    { pointer: "b#/y/value", values: [3, 4, 5] }
  ];
  assert.equal(cartesianSweep(dimensions).length, 6);
  assert.deepEqual(cartesianSweep(dimensions), cartesianSweep(dimensions));
});

test("promoted weighted defense expression reproduces the canonical pre-variance filter", async () => {
  const { engine, fixture } = await loadFixture();
  const result = engine.resolveEncounter(clone(fixture));
  const profiles = await loadDefenseCompositionProfiles(engine.config.specDir);
  const models = evaluateDefenseModels(result.trace.defense, profiles);
  assert.ok(Math.abs(models.weighted_then_bounded.filter - result.defenseFilter) < 1e-10);
  assert.equal(profiles.models.current_fully_multiplicative.canonical, false);
  assert.equal(profiles.models.weighted_then_bounded.canonical, true);
  assert.equal(profiles.models.grouped_composition.canonical, false);
});

test("centered variance distributions are deterministic, bounded, and more concentrated than uniform", async () => {
  const { engine } = await loadFixture();
  const deviations = {};
  for (const distribution of ["uniform", "centered_triangular", "bounded_normal_like"]) {
    const config = applyTuningOverrides(engine.config, [{ pointer: "attack.yaml#/micro_variance/distribution", value: distribution }]);
    const factors = [];
    for (let index = 0; index < 10000; index += 1) {
      const identity = { seed: index, simulationId: "test", turn: 1, actionId: "a", targetId: "t", component: "c" };
      const first = microVariance(config, identity);
      const second = microVariance(config, identity);
      assert.deepEqual(first, second);
      assert.ok(first.factor >= 0.99 && first.factor <= 1.01);
      factors.push(first.factor);
    }
    deviations[distribution] = Math.sqrt(factors.reduce((sum, factor) => sum + (factor - 1) ** 2, 0) / factors.length);
  }
  assert.ok(deviations.centered_triangular < deviations.uniform);
  assert.ok(deviations.bounded_normal_like < deviations.centered_triangular);
});

test("parameter sweep produces repeatable JSON data and CSV", async () => {
  const { engine } = await loadFixture();
  const templates = await loadProfileTemplates(engine.config.specDir);
  const generated = generateSpecializedProfiles(engine.config, templates);
  const assets = await loadBenchmarkAssets(engine.config.specDir);
  assets.generatedProfiles = generated;
  const profiles = profileIndex(generated);
  const options = {
    baseConfig: engine.config,
    dimensions: [{ pointer: "attack.yaml#/derived_offense/physical_power/physical_weight/value", values: [0.9, 1.1] }],
    repeats: 3,
    createEngine,
    encounterFactory: (variantEngine, seed) => buildBenchmarkEncounter({
      config: variantEngine.config,
      assets,
      attackerProfile: profiles.get("fighter:balanced"),
      defenderProfile: profiles.get("civilian:balanced"),
      seed,
      trace: false
    }),
    metric: (result) => result.healthDamage,
    suspicionScore: (row) => Math.max(0, row.metric.mean - 50)
  };
  const first = runParameterSweep(options);
  const second = runParameterSweep(options);
  assert.deepEqual(first, second);
  assert.equal(first.rows.length, 2);
  assert.match(sweepToCsv(first), /combinationIndex/);
});

test("balance findings remain diagnostics rather than hard invariants", async () => {
  const { engine } = await loadFixture();
  const invariantText = engine.config.specs["invariants.yaml"].invariants.map((item) => item.rule.toLowerCase()).join("\n");
  assert.doesNotMatch(invariantText, /fighter vs civilian|active defense appears|damage appears high|target win rate/);
});

test("opposed-weight normalization removes category drift without erasing specialization", async () => {
  const { engine } = await loadFixture();
  const templates = await loadProfileTemplates(engine.config.specDir);
  const generated = generateSpecializedProfiles(engine.config, templates);
  const assets = await loadBenchmarkAssets(engine.config.specDir);
  assets.generatedProfiles = generated;
  const profiles = profileIndex(generated);
  const categories = templates.applicable_categories;
  const balancedMargins = categories.map((category) => {
    const profile = profiles.get(`${category}:balanced`);
    return engine.resolveEncounter(buildBenchmarkEncounter({ config: engine.config, assets, attackerProfile: profile, defenderProfile: profile, seed: `normalized:${category}`, trace: true })).trace.accuracy.margin;
  });
  assert.ok(Math.max(...balancedMargins) - Math.min(...balancedMargins) < 2);
  const accurate = engine.resolveEncounter(buildBenchmarkEncounter({ config: engine.config, assets, attackerProfile: profiles.get("fighter:accuracy_coordination_specialist"), defenderProfile: profiles.get("fighter:balanced"), seed: "specialized", trace: true })).trace.accuracy.margin;
  const inaccurate = engine.resolveEncounter(buildBenchmarkEncounter({ config: engine.config, assets, attackerProfile: profiles.get("fighter:low_accuracy_high_power_attacker"), defenderProfile: profiles.get("fighter:balanced"), seed: "specialized", trace: true })).trace.accuracy.margin;
  assert.ok(accurate - inaccurate > 15);
});

test("balance expectations emit structured non-blocking warnings", async () => {
  const { engine } = await loadFixture();
  const warnings = evaluateBalanceExpectations(engine.config, {
    equalTierBalancedMargins: [0, 0.1, -0.1],
    averageDefenseEffectiveness: 0.29,
    damageByGap: { extreme: { mean: 79, p05: 70, p95: 98 } }
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "BALANCE_DAMAGE_EXTREME");
  assert.equal(warnings[0].nonBlocking, true);
});

test("centered triangular is the canonical micro-variance distribution", async () => {
  const { engine } = await loadFixture();
  assert.equal(engine.config.specs["attack.yaml"].micro_variance.distribution, "centered_triangular");
  const result = microVariance(engine.config, { seed: "canonical", simulationId: "test", turn: 0, actionId: "a", targetId: "b", component: "power" });
  assert.equal(result.distribution, "centered_triangular");
  assert.equal(result.samples.length, 2);
});
