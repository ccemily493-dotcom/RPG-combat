import { deepClone, deepFreeze } from "./utils.js";
import { ValidationError } from "./errors.js";

function decodePointerSegment(segment) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function parsePointer(pointer) {
  const marker = pointer.indexOf("#/");
  if (marker < 1) throw new ValidationError(`Invalid tuning pointer: ${pointer}`);
  return {
    file: pointer.slice(0, marker),
    segments: pointer.slice(marker + 2).split("/").map(decodePointerSegment)
  };
}

function findTarget(config, pointer) {
  const { file, segments } = parsePointer(pointer);
  let parent = config.specs[file];
  if (!parent) throw new ValidationError(`Unknown specification in tuning pointer: ${file}`);
  for (const segment of segments.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, segment)) {
      throw new ValidationError(`Unknown tuning pointer: ${pointer}`);
    }
    parent = parent[segment];
  }
  const key = segments.at(-1);
  if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) {
    throw new ValidationError(`Unknown tuning pointer: ${pointer}`);
  }
  return { parent, key };
}

function assertTunable(parent, key, pointer) {
  if (key === "value" && parent.tunable === true) return;
  if (parent[`${key}_tunable`] === true) return;
  throw new ValidationError(`Tuning pointer is not declared tunable: ${pointer}`);
}

export function applyTuningOverrides(config, overrides) {
  const variant = deepClone(config);
  const applied = [];
  for (const override of overrides) {
    const { parent, key } = findTarget(variant, override.pointer);
    assertTunable(parent, key, override.pointer);
    if (typeof parent[key] === "number" && !Number.isFinite(override.value)) {
      throw new ValidationError(`Numeric tuning override must be finite: ${override.pointer}`);
    }
    const before = parent[key];
    parent[key] = override.value;
    applied.push({ pointer: override.pointer, before, after: override.value });
  }
  variant.tuning = { baseVersion: config.version, overrides: applied };
  return deepFreeze(variant);
}

export function cartesianSweep(dimensions) {
  let rows = [[]];
  for (const dimension of dimensions) {
    if (!Array.isArray(dimension.values) || dimension.values.length === 0) {
      throw new ValidationError(`Sweep dimension has no values: ${dimension.pointer}`);
    }
    rows = rows.flatMap((row) => dimension.values.map((value) => [...row, { pointer: dimension.pointer, value }]));
  }
  return rows;
}
