import { deepFreeze } from "../utils.js";

const QUOTES = /[‘’‚‛`´]/gu;
const DOUBLE_QUOTES = /[“”„‟]/gu;
const TOKEN = /[\p{L}\p{N}_'-]+/gu;

export function foldForMatching(value) {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase("und");
}

export function normalizeSemanticText(originalText, options = {}) {
  if (typeof originalText !== "string") throw new TypeError("Semantic input must be a string.");
  const maximum = options.maximumCharacters ?? 4096;
  if (originalText.length > maximum) throw new RangeError(`Semantic input exceeds ${maximum} characters.`);
  const unicode = originalText.normalize("NFKC").replace(QUOTES, "'").replace(DOUBLE_QUOTES, '"');
  const tokens = [];
  for (const match of unicode.matchAll(TOKEN)) {
    const text = match[0].toLocaleLowerCase(options.locale ?? "und");
    tokens.push({ text, match: foldForMatching(text), start: match.index, end: match.index + match[0].length });
  }
  const normalizedText = tokens.map((token) => token.text).join(" ");
  const matchingText = tokens.map((token) => token.match).join(" ");
  return deepFreeze({ original_text: originalText, normalized_text: normalizedText, matching_text: matchingText, tokens });
}
