import { ResolutionError, ValidationError } from "./errors.js";
import { clamp, getPath, roundTo } from "./utils.js";

const LAYERS = Object.freeze(["WORLD", "CHARACTER", "ACTION"]);
const OPERATIONS = Object.freeze(["additive", "percentage", "multiplicative", "bounded"]);

function compare(left, operator, right) {
  switch (operator) {
    case "eq": return left === right;
    case "ne": return left !== right;
    case "lt": return left < right;
    case "lte": return left <= right;
    case "gt": return left > right;
    case "gte": return left >= right;
    case "in": return Array.isArray(right) && right.includes(left);
    case "contains": return (Array.isArray(left) || typeof left === "string") && left.includes(right);
    default: throw new ValidationError(`Unsupported predicate operator: ${operator}`);
  }
}

export function evaluatePredicate(predicate, context) {
  if (!predicate) return true;
  if (predicate.all) return predicate.all.every((child) => evaluatePredicate(child, context));
  if (predicate.any) return predicate.any.some((child) => evaluatePredicate(child, context));
  if (predicate.not) return !evaluatePredicate(predicate.not, context);
  if (predicate.compare) {
    const { left, operator, right } = predicate.compare;
    const leftValue = typeof left === "string" ? getPath(context, left) : left;
    const rightValue = right && typeof right === "object" && Object.hasOwn(right, "path")
      ? getPath(context, right.path)
      : right;
    if (leftValue === undefined || rightValue === undefined) return false;
    return compare(leftValue, operator, rightValue);
  }
  if (predicate.has_tag) {
    const subject = getPath(context, predicate.has_tag.subject);
    return Array.isArray(subject?.tags) && subject.tags.includes(predicate.has_tag.tag);
  }
  throw new ValidationError("Unsupported predicate node.", predicate);
}

function matchesTarget(modifier, target, targetTags) {
  if (modifier.target === target) return true;
  if (modifier.target.startsWith("tag:")) return targetTags.includes(modifier.target.slice(4));
  return false;
}

function representativeValue(modifier) {
  if (modifier.operation === "bounded") return modifier.upper ?? modifier.lower ?? 0;
  return modifier.value;
}

function resolveStack(group) {
  if (group.length === 1) return group;
  const rules = new Set(group.map((modifier) => modifier.stacking_rule ?? "unique"));
  if (rules.size !== 1) throw new ResolutionError("Conflicting stacking rules.", group.map((item) => item.id));
  const rule = group[0].stacking_rule ?? "unique";
  if (rule === "stack") return group;
  if (rule === "unique") throw new ResolutionError("Unique stacking key has multiple active modifiers.", group.map((item) => item.id));
  const sorted = [...group].sort((a, b) => {
    if (rule === "lowest") return representativeValue(a) - representativeValue(b) || a.id.localeCompare(b.id);
    if (rule === "highest") return representativeValue(b) - representativeValue(a) || a.id.localeCompare(b.id);
    return (b.priority ?? 0) - (a.priority ?? 0) || b.id.localeCompare(a.id);
  });
  return [sorted[0]];
}

export function resolveModifiers(baseValue, target, modifierLists, context, options = {}) {
  const all = modifierLists.flat().filter(Boolean);
  const ids = new Set();
  for (const modifier of all) {
    if (ids.has(modifier.id)) throw new ValidationError(`Duplicate modifier id: ${modifier.id}`);
    ids.add(modifier.id);
    if (!LAYERS.includes(modifier.layer)) throw new ValidationError(`Invalid modifier layer: ${modifier.layer}`);
    if (!OPERATIONS.includes(modifier.operation)) throw new ValidationError(`Invalid modifier operation: ${modifier.operation}`);
  }

  const rejected = [];
  const candidates = all.filter((modifier) => {
    if (!matchesTarget(modifier, target, options.targetTags ?? [])) {
      rejected.push({ id: modifier.id, reason: "target_mismatch" });
      return false;
    }
    if (!evaluatePredicate(modifier.when, context)) {
      rejected.push({ id: modifier.id, reason: "condition_false" });
      return false;
    }
    return true;
  });

  const groups = new Map();
  for (const modifier of candidates) {
    const key = `${modifier.layer}|${modifier.operation}|${modifier.stacking_key ?? modifier.id}`;
    groups.set(key, [...(groups.get(key) ?? []), modifier]);
  }
  const active = [...groups.values()].flatMap(resolveStack);
  active.sort((a, b) => {
    const operation = OPERATIONS.indexOf(a.operation) - OPERATIONS.indexOf(b.operation);
    if (operation) return operation;
    const layer = LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer);
    if (layer) return layer;
    return (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id);
  });

  const lowers = active.filter((m) => m.operation === "bounded" && m.lower !== undefined).map((m) => m.lower);
  const uppers = active.filter((m) => m.operation === "bounded" && m.upper !== undefined).map((m) => m.upper);
  if (lowers.length && uppers.length && Math.max(...lowers) > Math.min(...uppers)) {
    throw new ResolutionError("Incompatible modifier bounds.", { lowers, uppers });
  }

  let value = baseValue;
  const steps = [];
  for (const modifier of active) {
    const before = value;
    switch (modifier.operation) {
      case "additive": value += modifier.value; break;
      case "percentage": value *= 1 + modifier.value / 100; break;
      case "multiplicative": value *= modifier.value; break;
      case "bounded": value = clamp(modifier.lower ?? -Infinity, modifier.upper ?? Infinity, value); break;
    }
    steps.push({ id: modifier.id, layer: modifier.layer, operation: modifier.operation, before, after: value });
  }
  if (options.clamp) value = clamp(options.clamp[0], options.clamp[1], value);
  value = roundTo(value, options.decimals ?? 12);

  return Object.freeze({
    baseValue,
    target,
    activeModifierIds: Object.freeze(active.map((modifier) => modifier.id)),
    rejected: Object.freeze(rejected),
    steps: Object.freeze(steps),
    finalValue: value
  });
}
