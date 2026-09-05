import { canonicalHash, deepClone, deepFreeze } from "../utils.js";

export class SemanticParseCache {
  #phrases = new Map();
  #contexts = new Map();
  #stats = { phrase_hits: 0, context_hits: 0, misses: 0 };
  phraseKey(normalizedText, locale, dictionaryHash, parserVersion, abilityRegistryHash = null) { return canonicalHash({ normalizedText, locale, dictionaryHash, parserVersion, abilityRegistryHash }); }
  contextKey(phraseKey, contextSignature) { return canonicalHash({ phraseKey, contextSignature }); }
  getPhrase(key) { const value = this.#phrases.get(key); if (value) this.#stats.phrase_hits += 1; return value ? deepFreeze(deepClone(value)) : null; }
  getContext(key) { const value = this.#contexts.get(key); if (value) this.#stats.context_hits += 1; else this.#stats.misses += 1; return value ? deepFreeze(deepClone(value)) : null; }
  setPhrase(key, value) { this.#phrases.set(key, deepFreeze(deepClone(value))); }
  setContext(key, value) { this.#contexts.set(key, deepFreeze(deepClone(value))); }
  stats() { return deepFreeze({ ...this.#stats, phrase_size: this.#phrases.size, context_size: this.#contexts.size }); }
  clear() { this.#phrases.clear(); this.#contexts.clear(); this.#stats = { phrase_hits: 0, context_hits: 0, misses: 0 }; }
}

export function semanticContextSignature(context = {}) {
  return canonicalHash({ actorId: context.actorId ?? null, entities: context.entities ?? [], focus: context.focus ?? [], distances: context.distances ?? {}, spatialLabels: context.spatialLabels ?? {}, defaultTargets: context.defaultTargets ?? [], worldTurn: context.world?.turn ?? null });
}
