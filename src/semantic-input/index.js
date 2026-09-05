export { loadSemanticConfig } from "./config.js";
export { compileSemanticDictionary, abilityAliasEntries, SemanticDictionaryCompilationCache, SEMANTIC_PARSER_VERSION } from "./dictionary.js";
export { normalizeSemanticText, foldForMatching } from "./normalizer.js";
export { applyMorphologyHooks, detectSemanticLocale, tokenizeSemanticInput } from "./tokenizer.js";
export { resolveSemanticEntities } from "./entities.js";
export { parseSemanticInput, inspectSemanticParse } from "./resolver.js";
export { compileSemanticIntent } from "./compiler.js";
export { validateSemanticIntent, assertSemanticAuthority } from "./validation.js";
export { validateSemanticSchema, semanticSchemas } from "./schemas.js";
export { SemanticParseCache, semanticContextSignature } from "./cache.js";
export { CandidateLearningStore } from "./candidate-learning.js";
export { SemanticFallbackProvider, DeterministicMockFallbackProvider } from "./llm-boundary.js";
export { summarizeSemanticParses } from "./diagnostics.js";
export { spanishEntries } from "./locales/es.js";
export { englishEntries } from "./locales/en.js";
export { ACTION_TYPES, DELIVERY_SUBTYPES, STRATEGIC_PRIMITIVES } from "./taxonomy.js";
export { SemanticInputError } from "./errors.js";
export { buildSemanticActionTemplates, buildSemanticDictionaryEntries, semanticEntities } from "./fixtures.js";

export function registerSemanticFallbackProvider(provider) {
  if (!provider || typeof provider.id !== "string" || typeof provider.parseSemanticFallback !== "function") throw new TypeError("Semantic fallback provider requires an id and parseSemanticFallback function.");
  return Object.freeze({ id: provider.id, parseSemanticFallback: provider.parseSemanticFallback.bind(provider) });
}
