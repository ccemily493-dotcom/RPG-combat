import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalHash, createDefaultEngine, loadSessionScenarios, summarizeStrategySessions } from "../src/index.js";

const engine = await createDefaultEngine();
const { scenarios } = await loadSessionScenarios(engine.config.specDir);

function resolveExpectedSequence(scenario) {
  let snapshot = structuredClone(scenario.initial_snapshot);
  const stepResults = [];
  const expectedErrors = [];
  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index];
    try {
      const result = engine.resolveSessionStep({ id: `${scenario.id}:report:${index}`, snapshot, declarations: step.declarations, registries: scenario.registries, seed: step.seed, trace: true });
      if (step.expected_error) throw new Error(`Expected ${step.expected_error} rejection did not occur.`);
      stepResults.push(result);
      snapshot = structuredClone(result.nextSnapshot);
    } catch (error) {
      if (!step.expected_error || !String(error.message).toLowerCase().includes(step.expected_error.toLowerCase())) throw error;
      expectedErrors.push({ step: index, expected: step.expected_error, message: error.message });
    }
  }
  return { outcome: "completed_steps", finalSnapshot: snapshot, stepResults, expectedErrors, resultHash: canonicalHash({ snapshot, stepHashes: stepResults.map((step) => step.resultHash), expectedErrors }) };
}

const scenarioResults = [];
for (const [id, scenario] of Object.entries(scenarios)) {
  try {
    const result = scenario.steps.some((step) => step.expected_error) && id !== "M" ? resolveExpectedSequence(scenario) : engine.resolveSession(scenario);
    scenarioResults.push({ id, expectedRejection: false, result });
  } catch (error) {
    scenarioResults.push({ id, expectedRejection: id === "M", error: error instanceof Error ? error.message : String(error) });
  }
}
const diagnostics = summarizeStrategySessions(scenarioResults);
const compact = scenarioResults.map((entry) => entry.result ? {
  id: entry.id,
  outcome: entry.result.outcome,
  turns: entry.result.stepResults.length,
  finalTurn: entry.result.finalSnapshot.world.turn,
  resultHash: entry.result.resultHash,
  strategyStates: entry.result.finalSnapshot.strategies.map((strategy) => ({
    strategyId: strategy.strategy_id,
    state: strategy.state,
    nodes: strategy.nodes.map((node) => ({ id: node.id, state: node.state }))
  })),
  temporalEventCount: entry.result.stepResults.reduce((sum, step) => sum + step.temporalEvents.length, 0)
} : { id: entry.id, outcome: "rejected_before_commit", expectedRejection: entry.expectedRejection, error: entry.error });
const report = { version: engine.config.version, generatedAt: new Date().toISOString(), scenarios: compact, diagnostics };
const reportDir = join(engine.config.specDir, "reports");
await mkdir(reportDir, { recursive: true });
await writeFile(join(reportDir, "strategy-session-diagnostics-v0.3.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const lines = [
  "# Strategy and Temporal Scenario Diagnostics — v0.3",
  "",
  "All values below are non-blocking diagnostics. No universal strategy-quality score or threshold is defined.",
  "",
  `- Scenarios resolved: ${diagnostics.sessionsResolved}`,
  `- Expected pre-commit rejections: ${diagnostics.sessionsRejectedBeforeCommit}`,
  `- Nodes executed: ${diagnostics.nodes.executed}`,
  `- Node success rate (fixture mix only): ${diagnostics.nodes.successRate === null ? "n/a" : (diagnostics.nodes.successRate * 100).toFixed(2) + "%"}`,
  `- Setup failure rate (fixture mix only): ${diagnostics.nodes.setupFailureRate === null ? "n/a" : (diagnostics.nodes.setupFailureRate * 100).toFixed(2) + "%"}`,
  `- Mean setup duration: ${diagnostics.setupDurationTurns.mean?.toFixed(3) ?? "n/a"} turns`,
  `- Mean declared payoff modifier magnitude: ${diagnostics.averageDeclaredPayoffModifier?.toFixed(3) ?? "n/a"}`,
  `- Reactions consumed: ${diagnostics.reactionsConsumed}`,
  `- Non-health/stability resource expenditure: ${diagnostics.resourceExpenditure.toFixed(3)}`,
  `- Opportunities created/triggered/unused-or-expired: ${diagnostics.opportunities.created}/${diagnostics.opportunities.triggered}/${diagnostics.opportunities.unusedOrExpired}`,
  "",
  "## Scenario results",
  "",
  "| Scenario | Outcome | Turns | Hash |",
  "|---|---:|---:|---|",
  ...compact.map((item) => `| ${item.id} | ${item.outcome} | ${item.turns ?? 0} | ${item.resultHash ?? "—"} |`),
  ""
];
await writeFile(join(reportDir, "strategy-session-diagnostics-v0.3.md"), `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote v0.3 strategy/session diagnostics for ${compact.length} scenarios.`);
