import { canonicalHash, deepClone, deepFreeze } from "../utils.js";
import { semanticContextSignature } from "./cache.js";
import { fieldConfidence, overallConfidence } from "./confidence.js";
import { semanticError, SemanticInputError } from "./errors.js";
import { normalizeSemanticText } from "./normalizer.js";
import { parseWithRules } from "./rule-parser.js";
import { validateSemanticIntent, assertSemanticAuthority } from "./validation.js";
import { validateSemanticSchema } from "./schemas.js";

function thresholds(config) {
  const source = config?.spec?.thresholds ?? {};
  return { direct: source.direct_accept?.value ?? 0.9, optional: source.accept_with_missing_optional_fields?.value ?? 0.8, fallback: source.fallback_required?.value ?? 0.65 };
}

function parseResult(status, intent, normalization, ambiguities = [], errors = [], candidates = []) {
  const result = { status, intent, normalization: deepClone(normalization), ambiguities: deepClone(ambiguities), errors: deepClone(errors), candidates: deepClone(candidates) };
  validateSemanticSchema("parseResult", result);
  return deepFreeze(result);
}

function negatedIntent(normalization, context, dictionary) {
  return { intent_id: context.intentId ?? `semantic:${canonicalHash({ text: normalization.original_text, actor: context.actorId }).slice(0, 16)}`, intent_type: "WAIT", actor_id: context.actorId ?? null, locale: context.locale ?? dictionary.locale ?? "und", original_text: normalization.original_text, normalized_text: normalization.normalized_text, confidence: { intent_type: 0.99, negation: 0.99, overall: 0.99 }, provenance: { parser_version: "0.5.0", parser_path: "RULE", locale: context.locale ?? dictionary.locale ?? "und", dictionary_hash: dictionary.hash, rule_ids: ["negation.basic"], dictionary_entries: [], fallback_provider_id: null, cache_status: "MISS", source_spans: [] } };
}

function normalizeFallbackCandidate(candidate, normalization, context, dictionary, providerId, config) {
  assertSemanticAuthority(candidate, "fallback");
  const value = deepClone(candidate);
  value.intent_id ??= context.intentId ?? `semantic:${canonicalHash({ text: normalization.original_text, actor: context.actorId }).slice(0, 16)}`;
  value.actor_id ??= context.actorId ?? null;
  value.locale ??= context.locale ?? dictionary.locale ?? "und";
  value.original_text ??= normalization.original_text;
  value.normalized_text ??= normalization.normalized_text;
  value.confidence ??= { intent_type: fieldConfidence("fallback", config) };
  value.confidence.overall ??= overallConfidence(value.confidence);
  value.provenance = { parser_version: "0.5.0", parser_path: "FALLBACK", locale: value.locale, dictionary_hash: dictionary.hash, rule_ids: [], dictionary_entries: [], fallback_provider_id: providerId, cache_status: "MISS", source_spans: [] };
  return validateSemanticIntent(value, context);
}

export async function parseSemanticInput(text, options) {
  if (!options?.dictionary) throw semanticError("SEMANTIC_SCHEMA_ERROR", "A compiled semantic dictionary is required.", "dictionary");
  const dictionary = options.dictionary;
  const config = options.config ?? null;
  const context = { ...(options.context ?? {}), locale: options.locale ?? options.context?.locale ?? dictionary.locale };
  const supportedLocales = config?.spec?.locales?.supported ?? ["es", "en"];
  if (!supportedLocales.includes(context.locale)) throw semanticError("LOCALE_UNSUPPORTED", `Unsupported semantic locale ${context.locale}.`, "locale");
  const normalization = normalizeSemanticText(text, { locale: context.locale, maximumCharacters: config?.spec?.limits?.maximum_input_characters?.value ?? 4096 });
  const cache = options.cache ?? null;
  const phraseKey = cache?.phraseKey(normalization.matching_text, context.locale, dictionary.hash, "0.5.0", context.abilityRegistry?.hash ?? null);
  const contextKey = phraseKey ? cache.contextKey(phraseKey, semanticContextSignature(context)) : null;
  const cached = contextKey ? cache.getContext(contextKey) : null;
  if (cached) {
    const copy = deepClone(cached);
    if (copy.intent) { copy.intent.provenance.parser_path = "CACHE"; copy.intent.provenance.cache_status = "CONTEXT_HIT"; }
    return parseResult(copy.status, copy.intent, copy.normalization, copy.ambiguities, copy.errors, copy.candidates);
  }
  const rule = parseWithRules(normalization, dictionary, context, config);
  if (phraseKey && !cache.getPhrase(phraseKey)) cache.setPhrase(phraseKey, { normalization, dictionary_hash: dictionary.hash });
  if (rule.negated) {
    const intent = validateSemanticIntent(negatedIntent(normalization, context, dictionary), context);
    const result = parseResult("RESOLVED", intent, normalization);
    if (contextKey) cache.setContext(contextKey, result);
    return result;
  }
  if (rule.entityResult.ambiguity) {
    const result = parseResult("NEEDS_DISAMBIGUATION", rule.intent, normalization, [rule.entityResult.ambiguity]);
    if (contextKey) cache.setContext(contextKey, result);
    return result;
  }
  const score = rule.intent?.confidence?.overall ?? 0;
  if (rule.intent && score >= thresholds(config).optional) {
    const intent = validateSemanticIntent(rule.intent, context);
    const result = parseResult("RESOLVED", intent, normalization);
    if (contextKey) cache.setContext(contextKey, result);
    return result;
  }
  const provider = options.fallbackProvider ?? null;
  if (!provider) return parseResult(rule.intent ? "LOW_CONFIDENCE" : "UNRESOLVED", rule.intent, normalization, [], [{ code: rule.intent ? "LOW_CONFIDENCE" : "UNKNOWN_ACTION", message: "Rule parsing did not produce an accepted intent." }], rule.matches);
  try {
    const untrusted = await provider.parseSemanticFallback({ original_text: text, normalization, rule_candidates: rule.matches, allowed_actions: options.allowedActions ?? [], allowed_primitives: options.allowedPrimitives ?? [], ability_registry: context.abilityRegistry ? { hash: context.abilityRegistry.hash, ids: context.abilityRegistry.ids } : null, entities: context.entities ?? [] }, { locale: context.locale });
    const intent = normalizeFallbackCandidate(untrusted, normalization, context, dictionary, provider.id, config);
    if (options.candidateStore && !rule.intent) options.candidateStore.record({ phrase: normalization.matching_text, locale: context.locale, proposed_mapping: intent.action ? { type: intent.action.type, subtype: intent.action.subtype } : { intent_type: intent.intent_type }, fallback_source: provider.id, confidence: intent.confidence.overall, context_signature: semanticContextSignature(context) });
    const result = parseResult("RESOLVED", intent, normalization, [], [], [untrusted]);
    if (contextKey) cache.setContext(contextKey, result);
    return result;
  } catch (error) {
    const semantic = error instanceof SemanticInputError ? error : semanticError("FALLBACK_VALIDATION_ERROR", error.message);
    return parseResult("REJECTED", null, normalization, [], [{ code: semantic.code === "SEMANTIC_SCHEMA_ERROR" ? "FALLBACK_VALIDATION_ERROR" : semantic.code, message: semantic.message, path: semantic.path, source_span: semantic.sourceSpan, details: semantic.details }]);
  }
}

export function inspectSemanticParse(result) {
  validateSemanticSchema("parseResult", result);
  return deepFreeze({ status: result.status, intent_type: result.intent?.intent_type ?? null, parser_path: result.intent?.provenance?.parser_path ?? null, overall_confidence: result.intent?.confidence?.overall ?? 0, ambiguity_count: result.ambiguities.length, error_codes: result.errors.map((error) => error.code), matched_entries: result.intent?.provenance?.dictionary_entries ?? [] });
}
