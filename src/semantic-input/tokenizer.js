import { foldForMatching, normalizeSemanticText } from "./normalizer.js";
import { semanticError } from "./errors.js";

export function detectSemanticLocale(text, hint = null, supported = ["es", "en"]) {
  if (hint) {
    if (!supported.includes(hint)) throw semanticError("LOCALE_UNSUPPORTED", `Unsupported semantic locale ${hint}.`, "locale");
    return hint;
  }
  const folded = foldForMatching(text);
  const scores = {
    es: (folded.match(/\b(?:el|la|le|lo|una|hacia|contra|para|me|no)\b/g) ?? []).length,
    en: (folded.match(/\b(?:the|a|him|her|toward|against|for|i|not)\b/g) ?? []).length
  };
  const ranked = supported.map((locale) => ({ locale, score: scores[locale] ?? 0 })).sort((a, b) => b.score - a.score || a.locale.localeCompare(b.locale));
  return ranked[0]?.score > 0 ? ranked[0].locale : null;
}

export function tokenizeSemanticInput(text, options = {}) {
  return normalizeSemanticText(text, options).tokens;
}

export function applyMorphologyHooks(token, rules = []) {
  const forms = new Set([foldForMatching(token)]);
  for (const rule of rules) {
    if (rule.type === "EXACT" && forms.has(foldForMatching(rule.input))) forms.add(foldForMatching(rule.output));
    if (rule.type === "SUFFIX" && foldForMatching(token).endsWith(foldForMatching(rule.suffix))) forms.add(`${foldForMatching(token).slice(0, -foldForMatching(rule.suffix).length)}${foldForMatching(rule.replacement ?? "")}`);
  }
  return Object.freeze([...forms].sort());
}
