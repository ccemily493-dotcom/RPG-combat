import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareBatchEquivalence, createDefaultEngine, loadCombatScenarios } from "../src/index.js";

const engine = await createDefaultEngine();
const fixture = await loadCombatScenarios(engine.config.specDir);
const descriptions = {
  A: "one attacker, one defender, one hit",
  B: "five individually resolved hits",
  C: "500-hit batch-safe action",
  D: "one action with explicit multi-target allocation",
  E: "two simultaneous reciprocal attacks",
  F: "attack with defensive reaction",
  G: "multi-hit action with limited reaction capacity",
  H: "explicit reaction interruption",
  I: "simultaneous repeated status applications",
  J: "conflicting displacement assignments",
  K: "insufficient resources for declared quantity",
  L: "status-heavy volley falling back to individual resolution"
};

function summarize(id, input) {
  const result = engine.resolveTurn(structuredClone(input));
  return {
    id,
    description: descriptions[id],
    outcome: result.outcome,
    reason: result.reason ?? null,
    actionOutcomes: result.actionResults.map((action) => ({
      id: action.id,
      outcome: action.outcome,
      resolutionMode: action.resolutionMode ?? null,
      representedHits: action.representedHitCount,
      resolvedGroups: action.hits?.length ?? 0,
      healthDamage: action.healthDamage ?? 0,
      targetAllocation: action.targetAllocation ?? [],
      batchSafetyReasons: action.batchSafetyReasons ?? []
    })),
    reactionOutcomes: result.reactionResults.map((reaction) => ({
      id: reaction.id,
      outcome: reaction.outcome,
      reason: reaction.reason ?? null,
      interruption: reaction.interruption ?? null
    })),
    conflicts: result.conflicts,
    resultHash: result.resultHash ?? null
  };
}

const scenarios = Object.entries(fixture.scenarios).map(([id, input]) => summarize(id, input));
const batchEquivalence = compareBatchEquivalence(engine, fixture.scenarios.C);
const report = {
  version: engine.config.version,
  generatedAt: new Date().toISOString(),
  scenarioCount: scenarios.length,
  committed: scenarios.filter((scenario) => scenario.outcome === "committed").length,
  expectedPreCommitAborts: scenarios.filter((scenario) => scenario.id === "K" && scenario.outcome === "aborted").length,
  scenarios,
  batchEquivalence
};

const reportDir = join(engine.config.specDir, "reports");
await mkdir(reportDir, { recursive: true });
await writeFile(join(reportDir, "combat-loop-scenario-results-v0.2.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdown = [
  "# Universal RPG Engine v0.2 — Combat-Loop Scenario Results",
  "",
  `- Scenarios: ${report.scenarioCount}`,
  `- Committed: ${report.committed}`,
  `- Expected pre-commit aborts: ${report.expectedPreCommitAborts}`,
  "",
  "| Scenario | Contract | Outcome | Modes | Represented hits | Applied reactions | Conflicts |",
  "|---|---|---|---|---:|---:|---|",
  ...scenarios.map((scenario) => {
    const modes = [...new Set(scenario.actionOutcomes.map((action) => action.resolutionMode).filter(Boolean))].join(", ") || "n/a";
    const hits = scenario.actionOutcomes.reduce((sum, action) => sum + action.representedHits, 0);
    const applied = scenario.reactionOutcomes.filter((reaction) => reaction.outcome === "applied").length;
    const conflicts = scenario.conflicts.map((conflict) => conflict.code).join(", ") || "none";
    return `| ${scenario.id} | ${scenario.description} | ${scenario.outcome} | ${modes} | ${hits} | ${applied} | ${conflicts} |`;
  }),
  "",
  "## Batch equivalence (Scenario C)",
  "",
  `- Classification valid: ${batchEquivalence.validClassification}`,
  `- Damage divergence: ${(batchEquivalence.divergence.damageRelative * 100).toFixed(4)}%`,
  `- Stability divergence: ${(batchEquivalence.divergence.stabilityRelative * 100).toFixed(4)}%`,
  `- Resource divergence: ${batchEquivalence.divergence.resourceAbsolute}`,
  `- Hit-count divergence: ${batchEquivalence.divergence.hitCountAbsolute}`,
  `- Status-count divergence: ${batchEquivalence.divergence.statusCountAbsolute}`,
  `- Target allocation equal: ${batchEquivalence.divergence.targetAllocationEqual}`,
  ""
].join("\n");
await writeFile(join(reportDir, "combat-loop-scenario-results-v0.2.md"), markdown, "utf8");
console.log(JSON.stringify({ scenarios: report.scenarioCount, committed: report.committed, expectedPreCommitAborts: report.expectedPreCommitAborts, batchEquivalenceValid: batchEquivalence.validClassification }, null, 2));
