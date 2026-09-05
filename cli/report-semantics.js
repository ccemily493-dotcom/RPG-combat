import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DeterministicMockFallbackProvider, SemanticParseCache, parseSemanticInput, summarizeSemanticParses } from "../src/semantic-input/index.js";
import { createSemanticToolContext } from "./semantic-context.js";

const tool = await createSemanticToolContext("es");
const cache = new SemanticParseCache();
const fallback = new DeterministicMockFallbackProvider("diagnostic-mock", () => ({
  intent_type: "ACTION",
  action: { type: "ATTACK", subtype: "PUNCH", targets: [{ entity_id: "b", source_span: null }], target_zone: null, direction: null, distance: null, intensity: null, quantity: 1, object_ref: null, execution_class: "ACTION", primitive: null },
  confidence: { intent_type: 0.75, action: 0.75, target: 0.75 }
}));
const corpus = [
  "le pego", "golpeo", "le doy una patada", "disparo cinco veces", "me alejo 3 metros", "esquivo", "bloqueo", "corro hacia B",
  "uso Heavy Strike contra B", "corro hacia B y lo golpeo", "tiro algo a su izquierda para distraerlo y me muevo detrás",
  "ataco al enemigo", "ataco al mejor objetivo", "no lo ataco", "hago una cosa indescriptible", "le meto un viaje"
];
const results = [];
for (const text of corpus) results.push(await parseSemanticInput(text, {
  dictionary: tool.dictionary, config: tool.config, locale: "es", cache,
  context: { ...tool.context, ...(text.includes("enemigo") || text.includes("mejor") ? { defaultTargets: [], focus: [] } : {}) },
  fallbackProvider: text === "le meto un viaje" ? fallback : null
}));
await parseSemanticInput("le pego", { dictionary: tool.dictionary, config: tool.config, locale: "es", cache, context: tool.context });
const summary = summarizeSemanticParses(results, tool.dictionary, cache);
const report = {
  version: "0.5.0", classification: "semantic_diagnostic", non_blocking: true,
  corpus_size: corpus.length, ...summary,
  fallback_boundary: { live_provider_implemented: false, deterministic_mock_calls: fallback.calls },
  candidate_learning: { automatic_promotion: false },
  warnings: results.flatMap((result, index) => result.errors.map((error) => ({ input: corpus[index], ...error })))
};
const root = tool.engine.config.specDir;
await writeFile(join(root, "reports", "semantic-input-diagnostics-v0.5.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdown = `# Semantic Input v0.5 Diagnostics\n\nThese diagnostics are non-blocking and cannot alter mechanics.\n\n- Corpus: ${report.corpus_size}\n- Resolved: ${report.resolved}\n- Rule path: ${(report.rule_rate * 100).toFixed(2)}%\n- Mock fallback path: ${(report.fallback_rate * 100).toFixed(2)}%\n- Ambiguous: ${(report.ambiguity_rate * 100).toFixed(2)}%\n- Unresolved/rejected: ${(report.unresolved_rate * 100).toFixed(2)}%\n- Dictionary entries: ${report.dictionary.entries}\n- Dictionary surfaces: ${report.dictionary.surfaces}\n- Dictionary collisions: ${report.dictionary.collisions.length}\n- Context-cache hits: ${report.cache.context_hits}\n- Live fallback provider: no\n- Automatic vocabulary promotion: no\n\nNo universal intent-quality or strategy-quality score is produced.\n`;
await writeFile(join(root, "reports", "semantic-input-diagnostics-v0.5.md"), markdown, "utf8");
console.log(JSON.stringify(report, null, 2));
