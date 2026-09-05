import { canonicalHash, deepClone, deepFreeze } from "../utils.js";

export class CandidateLearningStore {
  #candidates = new Map();
  record({ phrase, locale, proposed_mapping, fallback_source, confidence, context_signature }) {
    const id = canonicalHash({ phrase, locale, proposed_mapping });
    const prior = this.#candidates.get(id) ?? { candidate_id: id, phrase, locale, proposed_mapping: deepClone(proposed_mapping), fallback_sources: [], occurrence_count: 0, confidence_scores: [], contexts: [], conflicts: [], promoted: false };
    prior.occurrence_count += 1;
    if (!prior.fallback_sources.includes(fallback_source)) prior.fallback_sources.push(fallback_source);
    prior.confidence_scores.push(confidence);
    if (context_signature && !prior.contexts.includes(context_signature) && prior.contexts.length < 5) prior.contexts.push(context_signature);
    this.#candidates.set(id, prior);
    return deepFreeze(deepClone(prior));
  }
  snapshot() { return deepFreeze([...this.#candidates.values()].map((value) => deepClone(value)).sort((a, b) => a.candidate_id.localeCompare(b.candidate_id))); }
  promote() { throw new Error("Learned candidates require an external explicit review workflow; automatic promotion is forbidden."); }
}
