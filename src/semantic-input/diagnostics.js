import { deepClone, deepFreeze } from "../utils.js";

export function summarizeSemanticParses(results, dictionary = null, cache = null) {
  const total = results.length;
  const paths = results.map((result) => result.intent?.provenance?.parser_path ?? "NONE");
  const fieldValues = {};
  for (const result of results) for (const [field, value] of Object.entries(result.intent?.confidence ?? {})) (fieldValues[field] ??= []).push(value);
  const confidence = Object.fromEntries(Object.entries(fieldValues).map(([field, values]) => [field, { minimum: Math.min(...values), maximum: Math.max(...values), average: values.reduce((sum, value) => sum + value, 0) / values.length }]));
  const unknowns = new Map();
  for (const result of results.filter((item) => item.status === "UNRESOLVED" || item.status === "LOW_CONFIDENCE")) unknowns.set(result.normalization.matching_text, (unknowns.get(result.normalization.matching_text) ?? 0) + 1);
  return deepFreeze({
    total, resolved: results.filter((result) => result.status === "RESOLVED").length,
    rule_rate: total ? paths.filter((path) => path === "RULE").length / total : 0,
    fallback_rate: total ? paths.filter((path) => path === "FALLBACK").length / total : 0,
    cache_rate: total ? paths.filter((path) => path === "CACHE").length / total : 0,
    ambiguity_rate: total ? results.filter((result) => result.status === "NEEDS_DISAMBIGUATION").length / total : 0,
    unresolved_rate: total ? results.filter((result) => ["UNRESOLVED", "LOW_CONFIDENCE", "REJECTED"].includes(result.status)).length / total : 0,
    confidence, top_unknown_phrases: [...unknowns].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([phrase, count]) => ({ phrase, count })),
    dictionary: dictionary?.inspect?.() ?? null, cache: cache?.stats?.() ?? null
  });
}
