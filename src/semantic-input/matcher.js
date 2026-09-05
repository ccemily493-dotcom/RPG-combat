import { deepFreeze } from "../utils.js";

function tokenSpanForPhrase(normalization, startWord, wordCount) {
  const first = normalization.tokens[startWord];
  const last = normalization.tokens[startWord + wordCount - 1];
  return { start: first.start, end: last.end };
}

export function matchDictionary(normalization, dictionary) {
  const words = normalization.matching_text.split(" ").filter(Boolean);
  const matches = [];
  for (let start = 0; start < words.length; start += 1) {
    for (let length = 1; length <= words.length - start; length += 1) {
      const phrase = words.slice(start, start + length).join(" ");
      const candidates = dictionary.match(phrase);
      if (candidates.length) matches.push({ phrase, start_word: start, word_count: length, source_span: tokenSpanForPhrase(normalization, start, length), candidates });
    }
  }
  matches.sort((a, b) => a.start_word - b.start_word || b.word_count - a.word_count || b.candidates[0].namespace_rank - a.candidates[0].namespace_rank || a.candidates[0].entry_id.localeCompare(b.candidates[0].entry_id));
  const selected = [];
  const occupied = new Set();
  for (const match of matches) {
    const positions = Array.from({ length: match.word_count }, (_, offset) => match.start_word + offset);
    if (positions.some((position) => occupied.has(position))) continue;
    selected.push(match);
    positions.forEach((position) => occupied.add(position));
  }
  return deepFreeze(selected.sort((a, b) => a.start_word - b.start_word));
}
