import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { createDefaultEngine, loadCombatScenarios, loadSessionScenarios, quantile } from "../src/index.js";

const engine = await createDefaultEngine();
const { scenarios: combat } = await loadCombatScenarios(engine.config.specDir);
const { scenarios: sessions } = await loadSessionScenarios(engine.config.specDir);
const samples = Number(process.env.RPG_BENCHMARK_SAMPLES ?? 40);
const warmups = Number(process.env.RPG_BENCHMARK_WARMUPS ?? 5);

function measured(name, turns, resolver) {
  for (let index = 0; index < warmups; index += 1) resolver();
  const durations = [];
  const heapBefore = process.memoryUsage().heapUsed;
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    resolver();
    durations.push(performance.now() - start);
  }
  const heapAfter = process.memoryUsage().heapUsed;
  const medianMs = quantile(durations, 0.5);
  return {
    name,
    samples,
    turnsPerResolution: turns,
    medianResolutionMs: medianMs,
    p95ResolutionMs: quantile(durations, 0.95),
    medianMsPerTurn: medianMs / turns,
    p95MsPerTurn: quantile(durations, 0.95) / turns,
    resolutionsPerSecond: 1000 / medianMs,
    turnsPerSecond: 1000 * turns / medianMs,
    sampledHeapDeltaBytes: heapAfter - heapBefore
  };
}

function withoutTrace(value) {
  return { ...structuredClone(value), trace: false };
}

const noStrategyFive = withoutTrace(sessions.N);
noStrategyFive.initial_snapshot.strategies = [];
const twentyTurn = structuredClone(noStrategyFive);
twentyTurn.id = "benchmark:20-turn";
twentyTurn.steps = Array.from({ length: 20 }, (_, index) => ({ declarations: { actions: [], reactions: [] }, seed: `benchmark:20:${index}` }));
const directEmpty = {
  id: "benchmark:empty-turn",
  world: structuredClone(sessions.N.initial_snapshot.world),
  characters: structuredClone(sessions.N.initial_snapshot.characters),
  actions: [], reactions: [], registries: structuredClone(sessions.N.registries), seed: "benchmark:empty", trace: false
};

const cases = [
  measured("v0.2 single-hit turn", 1, () => engine.resolveTurn(withoutTrace(combat.A))),
  measured("v0.2 empty-turn control", 1, () => engine.resolveTurn(directEmpty)),
  measured("5-turn session, no strategy", 5, () => engine.resolveSession(noStrategyFive)),
  measured("5-turn linear Strategy DAG", 5, () => engine.resolveSession(withoutTrace(sessions.N))),
  measured("branching Strategy DAG", 2, () => engine.resolveSession(withoutTrace(sessions.F))),
  measured("multiple simultaneous strategies", 1, () => engine.resolveSession(withoutTrace(sessions.L))),
  measured("20-turn session", 20, () => engine.resolveSession(twentyTurn)),
  measured("persistent modifiers", 3, () => engine.resolveSession(withoutTrace(sessions.A))),
  measured("delayed effects", 2, () => engine.resolveSession(withoutTrace(sessions.C))),
  measured("5-turn Strategy DAG with trace", 5, () => engine.resolveSession({ ...structuredClone(sessions.N), trace: true }))
];

const byName = Object.fromEntries(cases.map((item) => [item.name, item]));
const directEmptyMedian = byName["v0.2 empty-turn control"].medianMsPerTurn;
const noStrategyMedian = byName["5-turn session, no strategy"].medianMsPerTurn;
const linearMedian = byName["5-turn linear Strategy DAG"].medianMsPerTurn;
const tracedMedian = byName["5-turn Strategy DAG with trace"].medianMsPerTurn;
const overhead = {
  schedulerAndTemporalMsPerTurn: noStrategyMedian - directEmptyMedian,
  schedulerAndTemporalPercent: directEmptyMedian ? (noStrategyMedian / directEmptyMedian - 1) * 100 : null,
  strategyDagMsPerTurn: linearMedian - noStrategyMedian,
  strategyDagPercent: noStrategyMedian ? (linearMedian / noStrategyMedian - 1) * 100 : null,
  traceMsPerTurn: tracedMedian - linearMedian,
  tracePercent: linearMedian ? (tracedMedian / linearMedian - 1) * 100 : null
};
const report = {
  version: engine.config.version,
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch, samples, warmups },
  methodology: "Warm in-process medians and p95 wall-clock durations; negative sampled heap deltas indicate garbage collection during the sample window.",
  cases,
  overhead
};
const reportDir = join(engine.config.specDir, "reports");
await mkdir(reportDir, { recursive: true });
await writeFile(join(reportDir, "session-performance-v0.3.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const lines = [
  "# Session Performance — v0.3",
  "",
  `Node ${process.version}; ${samples} measured runs after ${warmups} warmups.`,
  "",
  "| Case | Median total (ms) | p95 total (ms) | Median/turn (ms) | Turns/s | Heap delta (bytes) |",
  "|---|---:|---:|---:|---:|---:|",
  ...cases.map((item) => `| ${item.name} | ${item.medianResolutionMs.toFixed(3)} | ${item.p95ResolutionMs.toFixed(3)} | ${item.medianMsPerTurn.toFixed(3)} | ${item.turnsPerSecond.toFixed(1)} | ${item.sampledHeapDeltaBytes} |`),
  "",
  "## Measured overhead",
  "",
  `- Scheduler + temporal state: ${overhead.schedulerAndTemporalMsPerTurn.toFixed(3)} ms/turn (${overhead.schedulerAndTemporalPercent.toFixed(1)}%).`,
  `- Strategy DAG over no-strategy session: ${overhead.strategyDagMsPerTurn.toFixed(3)} ms/turn (${overhead.strategyDagPercent.toFixed(1)}%).`,
  `- Strategy trace: ${overhead.traceMsPerTurn.toFixed(3)} ms/turn (${overhead.tracePercent.toFixed(1)}%).`,
  "",
  "Heap deltas are coarse samples of the managed heap, not retained-memory measurements; garbage collection may make them negative.",
  ""
];
await writeFile(join(reportDir, "session-performance-v0.3.md"), `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote v0.3 session performance report with ${cases.length} cases.`);
