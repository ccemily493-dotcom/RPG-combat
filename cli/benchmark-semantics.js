import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DeterministicMockFallbackProvider, SemanticParseCache, compileSemanticDictionary, parseSemanticInput, spanishEntries } from "../src/semantic-input/index.js";
import { createSemanticToolContext } from "./semantic-context.js";

function percentile(values, fraction) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]; }
async function measure(name, fn, iterations) {
  const values = [];
  for (let index = 0; index < iterations; index += 1) { const start = performance.now(); await fn(index); values.push(performance.now() - start); }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { name, iterations, median_ms: percentile(values, 0.5), p95_ms: percentile(values, 0.95), operations_per_second: 1000 / average };
}
function syntheticEntries(count) {
  const base = spanishEntries[0];
  return Array.from({ length: count }, (_, index) => ({ ...structuredClone(base), entry_id: `bench.es.term_${index}`, surface_forms: [`termino ${index}`], examples: [], source: "synthetic-benchmark" }));
}

const tool = await createSemanticToolContext("es");
const parse = (text, cache = null) => parseSemanticInput(text, { dictionary: tool.dictionary, config: tool.config, locale: "es", context: tool.context, cache });
const measurements = [];
for (const [name, text] of [["simple_attack", "le pego"], ["movement", "me alejo 3 metros"], ["ability_alias", "uso Heavy Strike contra B"], ["sequence", "corro hacia B y lo golpeo"], ["strategy", "tiro algo a su izquierda para distraerlo y me muevo detrás"]]) measurements.push(await measure(name, () => parse(text), 500));
const cache = new SemanticParseCache();
await parse("le pego", cache);
measurements.push(await measure("warm_context_cache", () => parse("le pego", cache), 1000));
const phraseCache = new SemanticParseCache();
await parse("le pego", phraseCache);
measurements.push(await measure("warm_phrase_cache_new_context", (index) => parseSemanticInput("le pego", { dictionary: tool.dictionary, config: tool.config, locale: "es", cache: phraseCache, context: { ...tool.context, focus: ["b"], world: { ...tool.context.world, turn: index + 1 } } }), 250));
const fallback = new DeterministicMockFallbackProvider("benchmark-mock", () => ({ intent_type: "ACTION", action: { type: "ATTACK", subtype: "PUNCH", targets: [{ entity_id: "b", source_span: null }], target_zone: null, direction: null, distance: null, intensity: null, quantity: 1, object_ref: null, execution_class: "ACTION", primitive: null }, confidence: { intent_type: 0.75, action: 0.75, target: 0.75 } }));
measurements.push(await measure("fallback_boundary_validation", () => parseSemanticInput("expresión coloquial desconocida", { dictionary: tool.dictionary, config: tool.config, locale: "es", context: tool.context, fallbackProvider: fallback }), 250));
for (const count of [100, 1000, 10000, 50000]) measurements.push(await measure(`dictionary_compile_${count}`, () => compileSemanticDictionary(syntheticEntries(count), { locale: "es" }), 1));
const memoryBefore = process.memoryUsage().heapUsed;
const largeDictionary = compileSemanticDictionary(syntheticEntries(50000), { locale: "es" });
const memoryAfter = process.memoryUsage().heapUsed;
measurements.push(await measure("dictionary_lookup_50000", () => largeDictionary.match("termino 49999"), 1000));
const report = { version: "0.5.0", generated_at: new Date().toISOString(), measurements, context_cache: cache.stats(), phrase_cache: phraseCache.stats(), fallback_mock_calls: fallback.calls, dictionary_50000: largeDictionary.inspect(), approximate_heap_delta_bytes_50000: memoryAfter - memoryBefore };
const root = tool.engine.config.specDir;
await writeFile(join(root, "reports", "semantic-input-performance-v0.5.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const rows = measurements.map((item) => `| ${item.name} | ${item.iterations} | ${item.median_ms.toFixed(4)} | ${item.p95_ms.toFixed(4)} | ${item.operations_per_second.toFixed(0)} |`).join("\n");
const markdown = `# Semantic Input v0.5 Performance\n\nGenerated ${report.generated_at}. All timings are local and deterministic; no network or live LLM is involved.\n\n| Benchmark | Iterations | Median ms | p95 ms | Ops/s |\n|---|---:|---:|---:|---:|\n${rows}\n\nApproximate process heap delta for a retained 50,000-entry dictionary: ${(report.approximate_heap_delta_bytes_50000 / 1024 / 1024).toFixed(2)} MiB. This is a coarse observation, not a retained-heap profile.\n`;
await writeFile(join(root, "reports", "semantic-input-performance-v0.5.md"), markdown, "utf8");
console.log(JSON.stringify(report, null, 2));
