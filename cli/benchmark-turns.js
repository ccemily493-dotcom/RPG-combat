import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createDefaultEngine, loadCombatScenarios, summarize } from "../src/index.js";

const engine = await createDefaultEngine();
const scenarios = (await loadCombatScenarios(engine.config.specDir)).scenarios;

function variant(source, id, quantity) {
  const input = structuredClone(source);
  input.id = id;
  input.world.simulation_id = `performance:${id}`;
  input.seed = `performance:${id}`;
  input.actions[0].id = `${id}.attack`;
  input.actions[0].attack.quantity = quantity;
  input.actions[0].attack.targeting = { mode: "SINGLE", allocations: [] };
  return input;
}

const cases = [
  { id: "single_hit", input: scenarios.A, iterations: 200 },
  { id: "five_hit", input: scenarios.B, iterations: 100 },
  { id: "ten_hit", input: variant(scenarios.B, "ten_hit", 10), iterations: 75 },
  { id: "multi_target", input: scenarios.D, iterations: 100 },
  { id: "simultaneous_two_actor", input: scenarios.E, iterations: 100 },
  { id: "batch_100", input: variant(scenarios.C, "batch_100", 100), iterations: 50 },
  { id: "batch_500", input: scenarios.C, iterations: 20 },
  { id: "individual_100", input: { ...variant(scenarios.C, "individual_100", 100), force_individual: true }, iterations: 10 },
  { id: "individual_500", input: { ...scenarios.C, id: "individual_500", force_individual: true }, iterations: 3 }
];

function measure(input, iterations, trace) {
  for (let index = 0; index < Math.min(8, iterations); index += 1) engine.resolveTurn({ ...input, seed: `${input.seed}:warmup:${index}`, trace });
  const latencies = [];
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const itemStarted = performance.now();
    const result = engine.resolveTurn({ ...input, seed: `${input.seed}:sample:${index}`, trace });
    if (result.outcome !== "committed") throw new Error(`${input.id} did not commit during benchmark: ${result.reason}`);
    latencies.push(performance.now() - itemStarted);
  }
  const elapsedMs = performance.now() - started;
  const heapAfter = process.memoryUsage().heapUsed;
  return {
    iterations,
    elapsedMs,
    turnsPerSecond: iterations / (elapsedMs / 1000),
    latencyMs: summarize(latencies),
    heapDeltaBytes: heapAfter - heapBefore,
    approximateHeapDeltaPerTurnBytes: (heapAfter - heapBefore) / iterations
  };
}

const results = [];
for (const definition of cases) {
  const withoutTrace = measure(definition.input, definition.iterations, false);
  const traceIterations = Math.min(definition.iterations, definition.id.includes("individual_500") ? 1 : 25);
  const withTrace = measure(definition.input, traceIterations, true);
  results.push({
    id: definition.id,
    withoutTrace,
    withTrace,
    tracingMedianOverheadMs: Math.max(0, withTrace.latencyMs.median - withoutTrace.latencyMs.median)
  });
}

const validationTimes = [];
for (let index = 0; index < 500; index += 1) {
  const started = performance.now();
  engine.schemas.validate("turn", scenarios.E);
  validationTimes.push(performance.now() - started);
}
const validation = { iterations: validationTimes.length, latencyMs: summarize(validationTimes) };
const byId = Object.fromEntries(results.map((result) => [result.id, result]));
const batchSpeedup = {
  quantity100: byId.individual_100.withoutTrace.latencyMs.median / byId.batch_100.withoutTrace.latencyMs.median,
  quantity500: byId.individual_500.withoutTrace.latencyMs.median / byId.batch_500.withoutTrace.latencyMs.median
};
const report = {
  version: "0.3",
  generatedAt: new Date().toISOString(),
  results,
  validation,
  batchSpeedup,
  memoryNote: "Heap deltas are sampled without forcing garbage collection; negative or noisy values reflect normal runtime collection and are not retained-memory measurements."
};
const markdown = `
# Universal RPG Engine v0.2 — Combat-Loop Performance

| Case | Iterations | Median ms | P95 ms | Turns/s | Trace overhead ms | Approx heap delta/turn |
|---|---:|---:|---:|---:|---:|---:|
${results.map((row) => `| ${row.id} | ${row.withoutTrace.iterations} | ${row.withoutTrace.latencyMs.median.toFixed(4)} | ${row.withoutTrace.latencyMs.p95.toFixed(4)} | ${row.withoutTrace.turnsPerSecond.toFixed(1)} | ${row.tracingMedianOverheadMs.toFixed(4)} | ${row.withoutTrace.approximateHeapDeltaPerTurnBytes.toFixed(0)} B |`).join("\n")}

- Schema-validation median: ${validation.latencyMs.median.toFixed(4)} ms; p95: ${validation.latencyMs.p95.toFixed(4)} ms.
- 100-hit batch median speedup: ${batchSpeedup.quantity100.toFixed(2)}×.
- 500-hit batch median speedup: ${batchSpeedup.quantity500.toFixed(2)}×.
- ${report.memoryNote}
`;
const reportDir = join(engine.config.specDir, "reports");
await mkdir(reportDir, { recursive: true });
await writeFile(join(reportDir, "combat-loop-performance-v0.2.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(join(reportDir, "combat-loop-performance-v0.2.md"), `${markdown.trim()}\n`, "utf8");
console.log(JSON.stringify({ cases: results.length, validationMedianMs: validation.latencyMs.median, batchSpeedup }, null, 2));
