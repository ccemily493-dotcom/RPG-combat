import { canonicalHash, deepClone, deepFreeze } from "../utils.js";
import { normalizeSemanticText } from "./normalizer.js";
import { semanticError } from "./errors.js";
import { validateSemanticSchema } from "./schemas.js";

export const SEMANTIC_PARSER_VERSION = "0.5.0";
export const DEFAULT_PRECEDENCE = Object.freeze({ SESSION: 600, EXTENSION: 500, CHARACTER: 400, ABILITY: 300, LOCALE: 200, UNIVERSAL: 100 });

function normalizedSurface(surface, locale) {
  return normalizeSemanticText(surface, { locale }).matching_text;
}

export class SemanticDictionaryCompilationCache {
  #entries = new Map();
  hits = 0;
  misses = 0;
  compile(entries, options = {}) {
    const key = canonicalHash({ entries, locale: options.locale ?? null, parser: SEMANTIC_PARSER_VERSION, extensionHashes: options.extensionHashes ?? {} });
    if (this.#entries.has(key)) { this.hits += 1; return this.#entries.get(key); }
    this.misses += 1;
    const compiled = compileSemanticDictionary(entries, { ...options, cache: null });
    this.#entries.set(key, compiled);
    return compiled;
  }
  clear() { this.#entries.clear(); this.hits = 0; this.misses = 0; }
}

export function compileSemanticDictionary(entries, options = {}) {
  if (options.cache) return options.cache.compile(entries, options);
  if (!Array.isArray(entries)) throw semanticError("SEMANTIC_SCHEMA_ERROR", "Dictionary definitions must be an array.", "entries");
  const locale = options.locale ?? null;
  const precedence = { ...DEFAULT_PRECEDENCE, ...(options.precedence ?? {}) };
  const definitions = [...entries].map((entry) => deepClone(entry)).sort((a, b) => a.entry_id.localeCompare(b.entry_id));
  const selectedDefinitions = definitions.filter((entry) => !locale || entry.locale === locale);
  const ids = new Set();
  const index = new Map();
  const collisions = [];
  for (const entry of definitions) validateSemanticSchema("dictionaryEntry", entry);
  for (const entry of selectedDefinitions) {
    if (ids.has(entry.entry_id)) throw semanticError("DICTIONARY_COLLISION", `Duplicate semantic entry ${entry.entry_id}.`, "entry_id");
    ids.add(entry.entry_id);
    for (const surface of entry.surface_forms) {
      const key = normalizedSurface(surface, entry.locale);
      const candidates = index.get(key) ?? [];
      candidates.push({ ...entry, matched_surface: surface, namespace_rank: precedence[entry.namespace] });
      candidates.sort((a, b) => b.namespace_rank - a.namespace_rank || b.priority - a.priority || a.entry_id.localeCompare(b.entry_id));
      index.set(key, candidates);
      if (candidates.length > 1 && candidates[0].namespace_rank === candidates[1].namespace_rank && candidates[0].priority === candidates[1].priority && (candidates[0].canonical_type !== candidates[1].canonical_type || candidates[0].canonical_subtype !== candidates[1].canonical_subtype || candidates[0].ability_id !== candidates[1].ability_id)) collisions.push({ surface: key, entry_ids: candidates.map((candidate) => candidate.entry_id) });
    }
  }
  const serializable = [...index].sort(([a], [b]) => a.localeCompare(b)).map(([surface, candidates]) => [surface, candidates.map((candidate) => candidate.entry_id)]);
  const hash = canonicalHash({ parser: SEMANTIC_PARSER_VERSION, locale, definitions: selectedDefinitions, extensionHashes: options.extensionHashes ?? {}, index: serializable });
  return deepFreeze({
    version: SEMANTIC_PARSER_VERSION, locale, hash, size: selectedDefinitions.length, collisions: [...collisions].sort((a, b) => a.surface.localeCompare(b.surface)),
    match(text) { return deepFreeze(deepClone(index.get(normalizedSurface(text, locale ?? "und")) ?? [])); },
    surfaces() { return Object.freeze([...index.keys()].sort()); },
    entries() { return deepFreeze(deepClone(selectedDefinitions)); },
    inspect() { return deepFreeze({ version: SEMANTIC_PARSER_VERSION, locale, hash, entries: selectedDefinitions.length, surfaces: index.size, collisions: deepClone(collisions) }); }
  });
}

export function abilityAliasEntries(abilityRegistry) {
  if (!abilityRegistry?.values) return [];
  return abilityRegistry.values().flatMap((ability) => Object.entries(ability.semantic_aliases ?? {}).flatMap(([locale, aliases]) => aliases.map((surface, index) => ({
    entry_id: `ability.${locale}.${ability.ability_id.replace(/[^a-z0-9_.:-]/gi, "_")}.${index}`.toLowerCase(), locale, namespace: "ABILITY", version: ability.ability_version,
    surface_forms: [surface], canonical_type: "USE_ABILITY", canonical_subtype: null, ability_id: ability.ability_id, tags: ["ability_alias"], priority: 0,
    constraints: { ability_context_only: true }, examples: [], source: `ability-registry:${abilityRegistry.hash}`
  }))));
}
