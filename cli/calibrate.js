import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyTuningOverrides,
  benchmarkPerformance,
  boundedHarmCapacityMultiplier,
  buildBenchmarkEncounter,
  createDefaultEngine,
  createEngine,
  evaluateBalanceExpectations,
  generateSpecializedProfiles,
  histogram,
  loadBenchmarkAssets,
  loadDefenseCompositionProfiles,
  loadProfileTemplates,
  microVariance,
  profileIndex,
  runCohort,
  summarize,
  summarizeCohort,
  summarizeDefenseComparisons,
  thresholdDiagnostics,
  validateSpecializedProfiles
} from "../src/index.js";

const engine = await createDefaultEngine();
const specDir = engine.config.specDir;
const reportDir = join(specDir, "reports");
await mkdir(reportDir, { recursive: true });

const templates = await loadProfileTemplates(specDir);
const generatedProfiles = generateSpecializedProfiles(engine.config, templates);
const profileValidation = validateSpecializedProfiles(engine.config, generatedProfiles);
if (!profileValidation.ok) throw new Error(profileValidation.issues.join("\n"));
await writeFile(join(specDir, "fixtures", "specialized-benchmark-profiles.json"), `${JSON.stringify(generatedProfiles, null, 2)}\n`, "utf8");
const assets = await loadBenchmarkAssets(specDir);
assets.generatedProfiles = generatedProfiles;
const profiles = profileIndex(generatedProfiles);
const categoryOrder = Object.entries(engine.config.specs["categories.yaml"].categories)
  .sort(([, a], [, b]) => a.order - b.order)
  .map(([id]) => id);
const thresholds = [-20, 0, 20];
let statisticalEncounterCount = 0;

function qualityBand(margin) {
  if (margin < thresholds[0]) return "miss";
  if (margin < thresholds[1]) return "graze";
  if (margin < thresholds[2]) return "partial";
  return "solid";
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

async function writeReport(id, json, markdown) {
  await writeFile(join(reportDir, `${id}.json`), `${JSON.stringify(json, null, 2)}\n`, "utf8");
  await writeFile(join(reportDir, `${id}.md`), `${markdown.trim()}\n`, "utf8");
}

// Accuracy-band and stat sensitivity analysis.
const accuracyProfileRows = [];
const allMargins = [];
const accuracyRepeats = 64;
for (const attackerProfile of generatedProfiles.profiles) {
  const defenderProfile = profiles.get(`${attackerProfile.category}:balanced`);
  const results = runCohort(engine, { assets, attackerProfile, defenderProfile, trace: true }, accuracyRepeats, `accuracy:${attackerProfile.id}`);
  statisticalEncounterCount += results.length;
  const margins = results.map((result) => result.trace.accuracy.margin);
  allMargins.push(...margins);
  accuracyProfileRows.push({
    profile: attackerProfile.id,
    defender: defenderProfile.id,
    ...summarizeCohort(results),
    thresholdDiagnostics: thresholdDiagnostics(margins, thresholds)
  });
}

const fighter = engine.config.specs["categories.yaml"].categories.fighter;
const sensitivityValues = Array.from({ length: 5 }, (_, index) => fighter.range.min.value + (fighter.range.max.value - fighter.range.min.value) * index / 4);
const sensitivityDimensions = [
  { owner: "actor", stat: "coordination" },
  { owner: "actor", stat: "perception" },
  { owner: "target", stat: "movement" },
  { owner: "target", stat: "reaction" },
  { owner: "target", stat: "coordination" }
];
const sensitivityRows = [];
for (const dimension of sensitivityDimensions) {
  for (const value of sensitivityValues) {
    const actorStatOverrides = dimension.owner === "actor" ? { [dimension.stat]: value } : {};
    const targetStatOverrides = dimension.owner === "target" ? { [dimension.stat]: value } : {};
    const results = runCohort(engine, {
      assets,
      attackerProfile: profiles.get("fighter:balanced"),
      defenderProfile: profiles.get("fighter:balanced"),
      actorStatOverrides,
      targetStatOverrides,
      trace: true
    }, 64, `sensitivity:${dimension.owner}:${dimension.stat}:${value}`);
    statisticalEncounterCount += results.length;
    const margins = results.map((result) => result.trace.accuracy.margin);
    sensitivityRows.push({ owner: dimension.owner, stat: dimension.stat, value, summary: summarizeCohort(results), thresholdDiagnostics: thresholdDiagnostics(margins, thresholds) });
  }
}

const accuracyRecommendations = [
  "Retain the current band thresholds until profile-specific target outcomes are agreed; the new results show deterministic specialization effects but do not define desired win rates.",
  "Opposed weight normalization removes the structural category-level drift while preserving differences created by within-category specialization.",
  "Review scenarios within five margin points of -20, 0, or 20 first, because small coefficient changes can change their categorical band while micro-variance cannot rescue distant cases.",
  "Judge actor coordination/perception and defender movement/reaction/coordination slopes separately before changing thresholds; their configured weights create different leverage by design.",
  "Keep category-neutral cohorts as controls, but use specialized profiles for future acceptance ranges so a category label is never treated as a complete identity."
];
const accuracyReport = {
  version: "0.3",
  canonicalPromotionsApplied: true,
  seeds: "accuracy:<profile>:<repeat> and sensitivity:<owner>:<stat>:<value>:<repeat>",
  thresholds,
  rawMarginDistribution: summarize(allMargins),
  rawMarginHistogram: histogram(allMargins, [-40, -20, -10, 0, 10, 20, 40]),
  aggregateThresholdDiagnostics: thresholdDiagnostics(allMargins, thresholds),
  bySpecializedProfile: accuracyProfileRows,
  independentStatSensitivity: sensitivityRows,
  recommendations: accuracyRecommendations
};
const accuracyMarkdown = `
# v0.3 Accuracy Sensitivity

- Profile cohorts: ${accuracyProfileRows.length} × ${accuracyRepeats} seeds
- Independent stat cohorts: ${sensitivityRows.length} × 64 seeds
- Raw margin mean: ${accuracyReport.rawMarginDistribution.mean.toFixed(3)}
- Median distance to nearest threshold: ${accuracyReport.aggregateThresholdDiagnostics.nearestDistance.median.toFixed(3)}

## Samples near thresholds

| Threshold | Within ±1 | Within ±2 | Within ±5 |
|---:|---:|---:|---:|
${accuracyReport.aggregateThresholdDiagnostics.thresholds.map((row) => `| ${row.threshold} | ${percent(row.near["1"])} | ${percent(row.near["2"])} | ${percent(row.near["5"])} |`).join("\n")}

## Specialized profiles

| Attacker profile | Mean margin | P05 | P95 | Miss | Graze | Partial | Solid |
|---|---:|---:|---:|---:|---:|---:|---:|
${accuracyProfileRows.map((row) => `| ${row.profile} | ${row.accuracyMargin.mean.toFixed(2)} | ${row.accuracyMargin.p05.toFixed(2)} | ${row.accuracyMargin.p95.toFixed(2)} | ${percent(row.qualities.miss)} | ${percent(row.qualities.graze)} | ${percent(row.qualities.partial)} | ${percent(row.qualities.solid)} |`).join("\n")}

## Independent-stat sensitivity

| Owner/stat | Value | Mean margin | Nearest threshold median | Dominant band |
|---|---:|---:|---:|---|
${sensitivityRows.map((row) => `| ${row.owner}.${row.stat} | ${row.value.toFixed(2)} | ${row.summary.accuracyMargin.mean.toFixed(2)} | ${row.thresholdDiagnostics.nearestDistance.median.toFixed(2)} | ${Object.entries(row.summary.qualities).sort((a, b) => b[1] - a[1])[0][0]} |`).join("\n")}

## Recommendations

${accuracyRecommendations.map((item) => `- ${item}`).join("\n")}
`;
await writeReport("accuracy-sensitivity-report-v0.3", accuracyReport, accuracyMarkdown);

// Defense composition comparisons from canonical engine traces.
const defenseProfiles = await loadDefenseCompositionProfiles(specDir);
const defenseTraces = [];
const defenseProfileRows = [];
for (const defenderProfile of generatedProfiles.profiles) {
  const attackerProfile = profiles.get(`${defenderProfile.category}:balanced`);
  const results = runCohort(engine, { assets, attackerProfile, defenderProfile, trace: true }, 64, `defense:${defenderProfile.id}`);
  statisticalEncounterCount += results.length;
  const traces = results.map((result) => result.trace.defense).filter((trace) => trace.attempted);
  defenseTraces.push(...traces);
  defenseProfileRows.push({ profile: defenderProfile.id, comparison: summarizeDefenseComparisons(traces, defenseProfiles) });
}
const defenseSummary = summarizeDefenseComparisons(defenseTraces, defenseProfiles);
const largestCollapse = defenseSummary.stageCollapse[0];
const defenseRecommendations = [
  `The largest absolute canonical weighted-stage collapse is currently ${largestCollapse.stage} (mean loss ${(largestCollapse.mean * 100).toFixed(2)} percentage points at that stage).`,
  "Compatibility and coverage remain explicit weighted contributions plus zero-applicability gates; timing and execution remain independently traceable.",
  "The weighted model is now canonical. Fully multiplicative and grouped models remain comparison profiles only.",
  "Energy efficiency currently changes affordability rather than directly multiplying filtering. Keep it visible as a diagnostic so cost failures are not mistaken for composition collapse."
];
const defenseReport = {
  version: "0.3",
  canonicalPromotionsApplied: true,
  experimentalProfile: "experiments/defense-composition.yaml",
  traceCount: defenseTraces.length,
  aggregate: defenseSummary,
  bySpecializedDefender: defenseProfileRows,
  recommendations: defenseRecommendations
};
const defenseMarkdown = `
# v0.3 Defense Composition Comparison

The weighted model is canonical. The fully multiplicative and grouped models remain diagnostic comparisons.

## Model distributions

| Model | Mean filter | Median | P05 | P95 |
|---|---:|---:|---:|---:|
${Object.entries(defenseSummary.models).map(([id, row]) => `| ${defenseProfiles.models[id].label} | ${percent(row.mean)} | ${percent(row.median)} | ${percent(row.p05)} | ${percent(row.p95)} |`).join("\n")}

## Canonical factors

| Factor | Mean | Median | P05 | P95 |
|---|---:|---:|---:|---:|
${Object.entries(defenseSummary.factors).map(([id, row]) => `| ${id} | ${row.mean.toFixed(3)} | ${row.median.toFixed(3)} | ${row.p05.toFixed(3)} | ${row.p95.toFixed(3)} |`).join("\n")}

## Cumulative collapse ranking

| Stage | Mean absolute collapse | Mean stage factor |
|---|---:|---:|
${defenseSummary.stageCollapse.map((row) => `| ${row.stage} | ${percent(row.mean)} | ${defenseSummary.factors[row.stage].mean.toFixed(3)} |`).join("\n")}

## Recommendations

${defenseRecommendations.map((item) => `- ${item}`).join("\n")}
`;
await writeReport("defense-composition-comparison-report-v0.3", defenseReport, defenseMarkdown);

// Damage sensitivity over category gaps and specializations.
const categoryPairs = [];
for (let index = 0; index < categoryOrder.length; index += 1) categoryPairs.push({ gap: "equal", attacker: categoryOrder[index], defender: categoryOrder[index] });
for (let index = 0; index < categoryOrder.length - 1; index += 1) categoryPairs.push({ gap: "one_category", attacker: categoryOrder[index + 1], defender: categoryOrder[index] });
for (let index = 0; index < categoryOrder.length - 2; index += 1) categoryPairs.push({ gap: "two_categories", attacker: categoryOrder[index + 2], defender: categoryOrder[index] });
categoryPairs.push({ gap: "extreme", attacker: "legendary", defender: "civilian" });
const attackerSpecializations = Object.keys(templates.profiles);
const defenderSpecializations = ["balanced", "defense_resistance_specialist", "low_defense_glass_cannon"];
const damageGroups = new Map();
const damageRows = [];
for (const pair of categoryPairs) {
  for (const attackerSpecialization of attackerSpecializations) {
    for (const defenderSpecialization of defenderSpecializations) {
      const attackerProfile = profiles.get(`${pair.attacker}:${attackerSpecialization}`);
      const defenderProfile = profiles.get(`${pair.defender}:${defenderSpecialization}`);
      const results = runCohort(engine, { assets, attackerProfile, defenderProfile, trace: true }, 32, `damage:${pair.gap}:${attackerProfile.id}:${defenderProfile.id}`);
      statisticalEncounterCount += results.length;
      const damages = results.map((result) => result.healthDamage);
      damageGroups.set(pair.gap, [...(damageGroups.get(pair.gap) ?? []), ...damages]);
      damageRows.push({ gap: pair.gap, attacker: attackerProfile.id, defender: defenderProfile.id, damage: summarize(damages), quality: summarizeCohort(results).qualities });
    }
  }
}
const fighterCivilianResults = runCohort(engine, {
  assets,
  attackerProfile: profiles.get("fighter:balanced"),
  defenderProfile: profiles.get("civilian:balanced"),
  trace: true
}, 128, "investigate:fighter:civilian");
statisticalEncounterCount += fighterCivilianResults.length;
const fighterCivilianBreakdown = {
  basePower: summarize(fighterCivilianResults.map((result) => result.trace.offense.resolved.power.baseValue)),
  variedPower: summarize(fighterCivilianResults.map((result) => result.trace.offense.varied.power.output)),
  accuracyExposure: summarize(fighterCivilianResults.map((result) => result.trace.accuracy.exposureFactor)),
  contactPower: summarize(fighterCivilianResults.map((result) => result.trace.damage.contactPower)),
  activeDefenseFilter: summarize(fighterCivilianResults.map((result) => result.defenseFilter)),
  baseBodyFilter: summarize(fighterCivilianResults.map((result) => result.trace.damage.channels[0].baseBodyFilter / 100)),
  bodyAfterPenetration: summarize(fighterCivilianResults.map((result) => result.trace.damage.channels[0].bodyAfterPenetration / 100)),
  combinedFilter: summarize(fighterCivilianResults.map((result) => result.trace.damage.channels[0].combinedFilter)),
  residualPower: summarize(fighterCivilianResults.map((result) => result.trace.damage.channels[0].residualPower)),
  harmCapacityScale: summarize(fighterCivilianResults.map((result) => result.trace.damage.capacityScale)),
  harmCapacityMultiplier: summarize(fighterCivilianResults.map((result) => result.trace.damage.harmCapacityMultiplier.multiplier)),
  healthDamage: summarize(fighterCivilianResults.map((result) => result.healthDamage))
};
const harmCapacityBehavior = [0, 25, 50, 75, 100, 150].map((harmCapacity) => ({ harmCapacity, ...boundedHarmCapacityMultiplier(engine.config, harmCapacity) }));
const damageRecommendations = [
  "Do not silently change physical power, body resistance, or the approved bounded harm-capacity curve when a soft expectation emits a warning.",
  "Fighter vs Civilian now uses a bounded interpolated vulnerability multiplier rather than reciprocal division by capacity.",
  "Review glass-cannon and defense-specialist tails before using balanced means as tuning targets; specialization is intentionally large within overlapping category ranges.",
  "Establish human-approved damage bands for equal, one-category, two-category, and extreme gaps before promoting any balance expectation to a test."
];
const damageReport = {
  version: "0.3",
  canonicalPromotionsApplied: true,
  categoryPairs,
  byGap: Object.fromEntries([...damageGroups].map(([gap, values]) => [gap, summarize(values)])),
  byProfileMatchup: damageRows,
  fighterVsCivilianInvestigation: fighterCivilianBreakdown,
  harmCapacityBehavior,
  recommendations: damageRecommendations
};
const damageMarkdown = `
# v0.3 Damage Sensitivity

## Category-gap distributions

| Gap | Samples | Mean | Median | P05 | P95 | Maximum |
|---|---:|---:|---:|---:|---:|---:|
${Object.entries(damageReport.byGap).map(([gap, row]) => `| ${gap} | ${row.count} | ${row.mean.toFixed(2)} | ${row.median.toFixed(2)} | ${row.p05.toFixed(2)} | ${row.p95.toFixed(2)} | ${row.maximum.toFixed(2)} |`).join("\n")}

## Fighter vs Civilian canonical pipeline

| Stage | Mean |
|---|---:|
${Object.entries(fighterCivilianBreakdown).map(([stage, row]) => `| ${stage} | ${row.mean.toFixed(4)} |`).join("\n")}

The balanced Fighter starts at ${fighterCivilianBreakdown.basePower.mean.toFixed(2)} power, retains ${percent(fighterCivilianBreakdown.accuracyExposure.mean)} through its hit-quality exposure, and faces ${percent(fighterCivilianBreakdown.combinedFilter.mean)} combined filtering. The approved bounded harm-capacity multiplier is ${fighterCivilianBreakdown.harmCapacityMultiplier.mean.toFixed(3)}, producing ${fighterCivilianBreakdown.healthDamage.mean.toFixed(2)} average health damage.

## Harm-capacity curve

| Harm capacity | Capacity ratio | Damage multiplier |
|---:|---:|---:|
${harmCapacityBehavior.map((row) => `| ${row.harmCapacity} | ${row.ratio.toFixed(2)} | ${row.multiplier.toFixed(3)} |`).join("\n")}

## Recommendations

${damageRecommendations.map((item) => `- ${item}`).join("\n")}
`;
await writeReport("damage-sensitivity-report-v0.3", damageReport, damageMarkdown);

// Non-blocking balance regression warnings are intentionally separate from hard invariants.
const balancedMarginRows = accuracyProfileRows.filter((row) => row.profile.endsWith(":balanced"));
const balanceWarnings = evaluateBalanceExpectations(engine.config, {
  equalTierBalancedMargins: balancedMarginRows.map((row) => row.accuracyMargin.mean),
  averageDefenseEffectiveness: defenseSummary.models.weighted_then_bounded.mean,
  defenseSpecialistP95: Math.max(...defenseProfileRows.filter((row) => row.profile.endsWith(":defense_resistance_specialist")).map((row) => row.comparison.models.weighted_then_bounded.p95)),
  damageByGap: damageReport.byGap
});
const balanceReport = {
  version: "0.3",
  classification: "balance_expectation",
  buildBlocking: false,
  expectations: engine.config.specs["balance.yaml"],
  warningCount: balanceWarnings.length,
  warnings: balanceWarnings
};
const balanceMarkdown = `
# v0.3 Balance Regression Warnings

- Classification: balance expectation
- Build-blocking: no
- Structured warnings: ${balanceWarnings.length}

${balanceWarnings.length ? balanceWarnings.map((item) => `- ${item.code}: expected ${JSON.stringify(item.expectation)}, observed ${JSON.stringify(item.observed)}`).join("\n") : "- No configured balance expectations emitted warnings."}
`;
await writeReport("balance-regression-report-v0.3", balanceReport, balanceMarkdown);

// Micro-variance distribution comparison around accuracy and defense boundaries.
const distributionIds = engine.config.specs["attack.yaml"].micro_variance.supported_distributions;
const varianceRows = [];
const thresholdRows = [];
const defenseBoundaryRows = [];
for (const distribution of distributionIds) {
  const variantConfig = applyTuningOverrides(engine.config, [{ pointer: "attack.yaml#/micro_variance/distribution", value: distribution }]);
  const factors = [];
  for (let index = 0; index < 50000; index += 1) {
    factors.push(microVariance(variantConfig, { seed: `variance:${index}`, simulationId: "variance", turn: 0, actionId: "a", targetId: "t", component: "comparison" }).factor);
  }
  varianceRows.push({ distribution, factor: summarize(factors), maximumAbsoluteDeviation: Math.max(...factors.map((factor) => Math.abs(factor - 1))) });
  for (const threshold of thresholds) {
    for (const offset of [-0.5, -0.1, 0, 0.1, 0.5]) {
      let flips = 0;
      const originalMargin = threshold + offset;
      const originalBand = qualityBand(originalMargin);
      for (let index = 0; index < 2000; index += 1) {
        const factor = microVariance(variantConfig, { seed: `threshold:${index}`, simulationId: "variance", turn: 0, actionId: "a", targetId: "t", component: `${threshold}:${offset}` }).factor;
        const variedMargin = (50 + originalMargin) * factor - 50;
        if (qualityBand(variedMargin) !== originalBand) flips += 1;
      }
      thresholdRows.push({ distribution, threshold, offset, originalBand, flipFraction: flips / 2000 });
    }
  }
  for (const baseFilter of [0, 0.1, 1, 99, 99.9, 100]) {
    const outputs = factors.map((factor) => Math.min(100, Math.max(0, baseFilter * factor)));
    defenseBoundaryRows.push({ distribution, baseFilter, output: summarize(outputs), clippedLowFraction: outputs.filter((value) => value === 0).length / outputs.length, clippedHighFraction: outputs.filter((value) => value === 100).length / outputs.length });
  }
}
const varianceRecommendations = [
  "Centered triangular is now canonical; retain uniform and bounded normal-like as explicit comparison profiles.",
  "Centered triangular and bounded normal-like profiles reduce threshold-crossing frequency without changing bounds; compare that behavior specifically for cases already within one margin point of a threshold.",
  "Do not widen the 0.99–1.01 interval to create more diverse outcomes. Accuracy-band diversity should come from modeled stats, actions, world state, and specialization."
];
const varianceReport = { version: "0.3", canonicalDistribution: engine.config.specs["attack.yaml"].micro_variance.distribution, canonicalPromotionsApplied: true, samplesPerDistribution: 50000, distributions: varianceRows, accuracyThresholdBehavior: thresholdRows, defenseBoundaryBehavior: defenseBoundaryRows, recommendations: varianceRecommendations };
const varianceMarkdown = `
# v0.3 Micro-Variance Comparison

| Distribution | Mean factor | Standard deviation | Minimum | Maximum | Max absolute deviation |
|---|---:|---:|---:|---:|---:|
${varianceRows.map((row) => `| ${row.distribution} | ${row.factor.mean.toFixed(7)} | ${row.factor.standardDeviation.toFixed(7)} | ${row.factor.minimum.toFixed(7)} | ${row.factor.maximum.toFixed(7)} | ${row.maximumAbsoluteDeviation.toFixed(7)} |`).join("\n")}

All sampled values remained inside 0.99–1.01. Centered distributions are visibly narrower while remaining deterministic and bounded.

## Defense-boundary behavior

| Distribution | Base filter | Mean output | P05 | P95 | Clipped at 0 | Clipped at 100 |
|---|---:|---:|---:|---:|---:|---:|
${defenseBoundaryRows.map((row) => `| ${row.distribution} | ${row.baseFilter.toFixed(1)}% | ${row.output.mean.toFixed(4)}% | ${row.output.p05.toFixed(4)}% | ${row.output.p95.toFixed(4)}% | ${percent(row.clippedLowFraction)} | ${percent(row.clippedHighFraction)} |`).join("\n")}

## Accuracy threshold flips

| Distribution | Threshold | Starting offset | Starting band | Flip rate |
|---|---:|---:|---|---:|
${thresholdRows.map((row) => `| ${row.distribution} | ${row.threshold} | ${row.offset} | ${row.originalBand} | ${percent(row.flipFraction)} |`).join("\n")}

## Recommendations

${varianceRecommendations.map((item) => `- ${item}`).join("\n")}
`;
await writeReport("micro-variance-comparison-report-v0.3", varianceReport, varianceMarkdown);

// Expanded controls and performance.
const neutralMatchups = [["civilian", "civilian"], ["fighter", "civilian"], ["fighter", "fighter"], ["elite", "fighter"], ["legendary", "civilian"]];
const neutralRows = neutralMatchups.map(([attacker, defender]) => {
  const results = runCohort(engine, { assets, attackerProfile: profiles.get(`${attacker}:balanced`), defenderProfile: profiles.get(`${defender}:balanced`), trace: true }, 256, `benchmark:${attacker}:${defender}`);
  statisticalEncounterCount += results.length;
  return { matchup: `${attacker}:balanced vs ${defender}:balanced`, ...summarizeCohort(results) };
});
const performanceInput = buildBenchmarkEncounter({ config: engine.config, assets, attackerProfile: profiles.get("fighter:balanced"), defenderProfile: profiles.get("civilian:balanced"), seed: "performance", trace: false });
const performanceReport = benchmarkPerformance(engine, performanceInput, 300);
const benchmarkRecommendations = [
  "Keep schema validation enabled in public resolution; its isolated median cost is reported rather than removed.",
  "Treat tracing overhead results as audit-emission overhead because canonical mechanical audit calculations remain enabled for replay integrity.",
  "Use the same seeded cohorts when comparing future tuning profiles so performance and outcome changes are attributable."
];
const benchmarkReport = {
  version: "0.3",
  generatedAt: new Date().toISOString(),
  profileFixtureCount: generatedProfiles.profiles.length,
  statisticalEncounterCount,
  neutralControls: neutralRows,
  performance: performanceReport,
  recommendations: benchmarkRecommendations
};
const benchmarkMarkdown = `
# v0.3 Expanded Calibration Benchmark

- Specialized fixtures: ${generatedProfiles.profiles.length}
- Seeded statistical encounters: ${statisticalEncounterCount.toLocaleString("en-US")}
- Resolution throughput (trace suppressed): ${performanceReport.noTrace.operationsPerSecond.toFixed(0)} encounters/second
- Median resolution time: ${performanceReport.noTrace.latencyMs.median.toFixed(4)} ms
- P95 resolution time: ${performanceReport.noTrace.latencyMs.p95.toFixed(4)} ms
- Median trace-emission overhead: ${performanceReport.tracingMedianOverheadMs.toFixed(4)} ms
- Median isolated schema-validation overhead: ${performanceReport.schemaValidation.latencyMs.median.toFixed(4)} ms (${percent(performanceReport.schemaMedianShareOfResolution)} of median full resolution)

## Neutral controls

| Matchup | Mean margin | Mean damage | Mean stability | Mean defense |
|---|---:|---:|---:|---:|
${neutralRows.map((row) => `| ${row.matchup} | ${row.accuracyMargin.mean.toFixed(2)} | ${row.healthDamage.mean.toFixed(2)} | ${row.stabilityDamage.mean.toFixed(2)} | ${percent(row.activeDefenseFilter.mean)} |`).join("\n")}

## Recommendations

${benchmarkRecommendations.map((item) => `- ${item}`).join("\n")}
`;
await writeReport("benchmark-report-v0.3", benchmarkReport, benchmarkMarkdown);

console.log(JSON.stringify({
  profiles: generatedProfiles.profiles.length,
  statisticalEncounters: statisticalEncounterCount,
  reports: 6,
  encountersPerSecond: performanceReport.noTrace.operationsPerSecond,
  medianMs: performanceReport.noTrace.latencyMs.median,
  p95Ms: performanceReport.noTrace.latencyMs.p95
}, null, 2));
