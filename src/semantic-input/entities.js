import { foldForMatching } from "./normalizer.js";

function entityNames(entity, locale) {
  const localized = Array.isArray(entity.names) ? entity.names : (entity.names?.[locale] ?? []);
  return [entity.id, ...localized, ...(entity.aliases ?? [])].map((value) => foldForMatching(String(value)));
}

function spanFor(normalization, phrase) {
  const folded = foldForMatching(phrase);
  const token = normalization.tokens.find((item) => item.match === folded);
  return token ? { start: token.start, end: token.end } : null;
}

export function resolveSemanticEntities(normalization, context = {}) {
  const locale = context.locale ?? "es";
  const entities = [...(context.entities ?? [])].filter((entity) => entity.id !== context.actorId).sort((a, b) => a.id.localeCompare(b.id));
  const explicit = [];
  for (const entity of entities) {
    for (const name of entityNames(entity, locale)) {
      const words = normalization.matching_text.split(" ");
      const nameWords = name.split(" ");
      for (let index = 0; index <= words.length - nameWords.length; index += 1) {
        if (words.slice(index, index + nameWords.length).join(" ") === name) {
          explicit.push({ entity_id: entity.id, source_span: { start: normalization.tokens[index].start, end: normalization.tokens[index + nameWords.length - 1].end }, evidence: "explicit_name" });
        }
      }
    }
  }
  explicit.sort((a, b) => a.source_span.start - b.source_span.start || a.entity_id.localeCompare(b.entity_id));
  if (explicit.length) {
    const correction = /\b(?:no|not)\b[^,;.]*[,;]?\s*(?:a|to)\s+([\p{L}\p{N}_-]+)/iu.test(normalization.original_text);
    const chosen = correction ? explicit.at(-1) : explicit[0];
    const multiMarker = /\b(?:todos|todas|ambos|all|both)\b/iu.test(normalization.original_text) || (new Set(explicit.map((item) => item.entity_id)).size > 1 && /\b(?:y|and)\b/iu.test(normalization.original_text));
    const unique = [...new Map(explicit.map((item) => [item.entity_id, item])).values()];
    return { targets: multiMarker ? unique : [chosen], ambiguity: null, evidence: correction ? "self_correction" : "explicit_name" };
  }
  const enemyMarker = /\b(?:enemigo|enemigos|enemy|enemies)\b/iu.test(normalization.original_text);
  const pronounMarker = /\b(?:lo|le|él|ella|ellos|ellas|him|her|them)\b/iu.test(normalization.original_text);
  const closestMarker = /\b(?:más cercano|mas cercano|closest|nearest)\b/iu.test(normalization.original_text);
  const leftMarker = /\b(?:de la izquierda|on the left|leftmost)\b/iu.test(normalization.original_text);
  const tacticalChoiceMarker = /\b(?:mejor objetivo|best target)\b/iu.test(normalization.original_text);
  let candidates = entities;
  if (enemyMarker) candidates = entities.filter((entity) => (entity.tags ?? []).includes("enemy"));
  if (closestMarker) {
    const distances = context.distances ?? {};
    const ranked = candidates.filter((entity) => Number.isFinite(distances[entity.id])).sort((a, b) => distances[a.id] - distances[b.id] || a.id.localeCompare(b.id));
    if (ranked.length && (ranked.length === 1 || distances[ranked[0].id] < distances[ranked[1].id])) return { targets: [{ entity_id: ranked[0].id, source_span: spanFor(normalization, closestMarker ? (locale === "es" ? "cercano" : "closest") : "") }], ambiguity: null, evidence: "deterministic_distance" };
    candidates = ranked;
  }
  if (leftMarker) {
    const ids = context.spatialLabels?.left ?? [];
    candidates = candidates.filter((entity) => ids.includes(entity.id));
  }
  if (pronounMarker) {
    const focused = (context.focus ?? []).filter((id) => candidates.some((entity) => entity.id === id));
    if (focused.length === 1) return { targets: [{ entity_id: focused[0], source_span: null }], ambiguity: null, evidence: "contextual_pronoun" };
    if (focused.length > 1) candidates = candidates.filter((entity) => focused.includes(entity.id));
    const defaults = (context.defaultTargets ?? []).filter((id) => candidates.some((entity) => entity.id === id));
    if (!focused.length && defaults.length === 1) return { targets: [{ entity_id: defaults[0], source_span: null }], ambiguity: null, evidence: "declared_default" };
  }
  const targetMarker = enemyMarker || pronounMarker || closestMarker || leftMarker || tacticalChoiceMarker;
  if (targetMarker && candidates.length === 1) return { targets: [{ entity_id: candidates[0].id, source_span: null }], ambiguity: null, evidence: "unique_context" };
  if (targetMarker && candidates.length > 1) return { targets: [], ambiguity: { code: "AMBIGUOUS_TARGET", field: "target", candidates: candidates.map((entity) => entity.id), source_span: null }, evidence: "ambiguous" };
  if ((context.defaultTargets ?? []).length === 1) return { targets: [{ entity_id: context.defaultTargets[0], source_span: null }], ambiguity: null, evidence: "declared_default" };
  return { targets: [], ambiguity: null, evidence: "missing" };
}
