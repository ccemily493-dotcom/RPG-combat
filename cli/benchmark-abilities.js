import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultEngine, loadCombatScenarios } from "../src/index.js";
import { AbilityCompilationCache, compileAbilityDefinition, compileAbilityRegistry, instantiateAbilityUse } from "../src/ability-parser/index.js";
import { buildGenericAbilityDefinitions } from "../src/ability-parser/fixtures.js";

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function measure(name, fn, iterations) {
  const values = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    fn(index);
    values.push(performance.now() - start);
  }
  return { name, iterations, median_ms: percentile(values, 0.5), p95_ms: percentile(values, 0.95), operations_per_second: 1000 / (values.reduce((a, b) => a + b, 0) / values.length) };
}

function expanded(definition, count) {
  return Array.from({ length: count }, (_, index) => {
    const value = structuredClone(definition);
    value.namespace = `bench${index}`;
    value.ability_id = `${value.namespace}.ability`;
    return value;
  });
}

const engine = await createDefaultEngine();
const { scenarios } = await loadCombatScenarios(engine.config.specDir);
const scenario = scenarios.A;
const definitions = buildGenericAbilityDefinitions();
const context = { rulesetVersion: engine.config.version, stats: Object.keys(engine.config.specs["stats.yaml"].stats), resources: Object.keys(scenario.characters.a.resources), registries: scenario.registries };
const byId = Object.fromEntries(definitions.map((item) => [item.ability_id, item]));
const registry = compileAbilityRegistry(definitions, context);
const invocation = (id, parameters = {}, targets = ["b"]) => ({ ability_id: id, actor_id: "a", targets: targets.map((ref) => ({ type: "character", ref, position: null, body_zone: "core" })), parameters, declared_options: { turn: 0 } });
const runtime = { characters: scenario.characters, world: scenario.world };
const measurements = [];
for (const [name, id] of [["simple_compile", "core.example.heavy_strike"], ["composite_compile", "core.example.dash_strike"], ["parameterized_compile", "core.example.parameterized_blast"], ["strategy_compile", "core.example.tactical_opening"]]) {
  measurements.push(measure(name, () => compileAbilityDefinition(byId[id], context), 100));
}
const cache = new AbilityCompilationCache();
cache.compile(byId["core.example.heavy_strike"], context);
measurements.push(measure("cached_compile", () => cache.compile(byId["core.example.heavy_strike"], context), 1000));
const memoryBefore = process.memoryUsage().heapUsed;
measurements.push(measure("registry_100", () => compileAbilityRegistry(expanded(definitions[0], 100), context), 3));
measurements.push(measure("registry_1000", () => compileAbilityRegistry(expanded(definitions[0], 1000), context), 1));
const memoryAfter = process.memoryUsage().heapUsed;
for (const [name, id, parameters, targets] of [
  ["simple_use", "core.example.heavy_strike", {}, ["b"]],
  ["multi_hit_use", "core.example.rapid_barrage", {}, ["b"]],
  ["multi_target_use", "core.example.area_pulse", {}, ["b", "b"]],
  ["composite_use", "core.example.dash_strike", {}, ["b"]],
  ["strategy_fragment_use", "core.example.tactical_opening", {}, ["b"]]
]) measurements.push(measure(name, () => instantiateAbilityUse(registry.get(id), invocation(id, parameters, targets), runtime), 1000));

const report = { version: "0.4.0", generated_at: new Date().toISOString(), measurements, cache: cache.stats(), approximate_heap_delta_bytes_for_registry_benchmarks: memoryAfter - memoryBefore };
const reportDir = join(engine.config.specDir, "reports");
await writeFile(join(reportDir, "ability-parser-performance-v0.4.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const rows = measurements.map((item) => `| ${item.name} | ${item.iterations} | ${item.median_ms.toFixed(4)} | ${item.p95_ms.toFixed(4)} | ${item.operations_per_second.toFixed(0)} |`).join("\n");
const markdown = `# Ability Parser v0.4 Performance\n\nGenerated ${report.generated_at}. Timings include schema/reference validation where compilation performs it.\n\n| Benchmark | Iterations | Median ms | p95 ms | Ops/s |\n|---|---:|---:|---:|---:|\n${rows}\n\nApproximate heap delta while exercising 100/1,000-entry registries: ${(report.approximate_heap_delta_bytes_for_registry_benchmarks / 1024 / 1024).toFixed(2)} MiB. This is a coarse process-level observation, not a retained-heap measurement.\n`;
await writeFile(join(reportDir, "ability-parser-performance-v0.4.md"), markdown, "utf8");
console.log(JSON.stringify(report, null, 2));
