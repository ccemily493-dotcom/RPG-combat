import { createHash } from "node:crypto";

export function clamp(minimum, maximum, value) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function lerp(start, end, fraction) {
  return start + (end - start) * fraction;
}

export function roundTo(value, decimals = 12) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}

export function deepClone(value) {
  return structuredClone(value);
}

export function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function getPath(root, path) {
  if (typeof path !== "string") return undefined;
  return path.split(".").reduce((value, key) => value?.[key], root);
}

export function weightedMean(entries) {
  const denominator = entries.reduce((sum, entry) => sum + Math.abs(entry.weight), 0);
  if (denominator === 0) return 0;
  return entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / denominator;
}

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
