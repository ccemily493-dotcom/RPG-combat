import { canonicalHash, stableStringify } from "./utils.js";

export function replay(engine, input, expected = null) {
  const first = engine.resolveEncounter({ ...input, trace: true });
  const second = engine.resolveEncounter({ ...input, trace: true });
  const firstCanonical = stableStringify(first);
  const secondCanonical = stableStringify(second);
  const deterministic = firstCanonical === secondCanonical;
  const actualHash = canonicalHash(first);
  const expectedHash = expected ? canonicalHash(expected) : null;
  return Object.freeze({
    deterministic,
    matchesExpected: expected ? firstCanonical === stableStringify(expected) : null,
    actualHash,
    expectedHash,
    result: first
  });
}

export function replayTurn(engine, input, expected = null) {
  const first = engine.resolveTurn({ ...input, trace: true });
  const second = engine.resolveTurn({ ...input, trace: true });
  const firstCanonical = stableStringify(first);
  const secondCanonical = stableStringify(second);
  const deterministic = firstCanonical === secondCanonical;
  const actualHash = canonicalHash(first);
  const expectedHash = expected ? canonicalHash(expected) : null;
  return Object.freeze({
    deterministic,
    matchesExpected: expected ? firstCanonical === stableStringify(expected) : null,
    actualHash,
    expectedHash,
    result: first
  });
}
