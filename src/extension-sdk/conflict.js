import { deepClone, deepFreeze } from "../utils.js";
import { extensionError } from "./errors.js";

export const CONFLICT_OUTCOMES = Object.freeze(["DOMINATE", "PARTIAL", "DESTABILIZE", "COLLAPSE", "MUTUAL", "LOCAL"]);

export function resolveMultiPropertyConflict(left, right, contract) {
  const properties = [...contract.properties].sort();
  const comparisons = properties.map((property) => {
    const l = Number(left[property] ?? 0);
    const r = Number(right[property] ?? 0);
    if (!Number.isFinite(l) || !Number.isFinite(r)) throw extensionError("EXTENSION_MECHANIC_ERROR", `Conflict property ${property} must be finite.`, property);
    const tolerance = contract.tolerances?.[property] ?? contract.default_tolerance ?? 0;
    return { property, left: l, right: r, delta: l - r, result: Math.abs(l - r) <= tolerance ? "TIED" : l > r ? "LEFT" : "RIGHT" };
  });
  const leftWins = comparisons.filter((item) => item.result === "LEFT").length;
  const rightWins = comparisons.filter((item) => item.result === "RIGHT").length;
  const decisive = Math.abs(leftWins - rightWins);
  const total = Math.max(1, comparisons.length);
  let outcome;
  if (leftWins === 0 && rightWins === 0) outcome = "MUTUAL";
  else if (decisive >= Math.ceil(total * (contract.domination_fraction ?? 0.6))) outcome = "DOMINATE";
  else if (comparisons.some((item) => item.property === contract.stability_property && item.result !== "TIED")) outcome = "DESTABILIZE";
  else outcome = "PARTIAL";
  return deepFreeze({ outcome, favored: leftWins === rightWins ? null : leftWins > rightWins ? "LEFT" : "RIGHT", comparisons: deepClone(comparisons), dominance: { left_properties: leftWins, right_properties: rightWins, tied_properties: total - leftWins - rightWins }, scalar_score: null });
}

export function resolveBindingContract(contract, event, state) {
  const requirements = [...(contract.requirements ?? [])];
  const satisfied = requirements.every((requirement) => {
    if (requirement.type === "EVENT_TAG") return event.tags?.includes(requirement.value);
    if (requirement.type === "TARGET") return event.target_ref === requirement.value;
    if (requirement.type === "RELATION_PRESENT") return state.relations?.some((relation) => relation.id === requirement.value);
    if (requirement.type === "RESOURCE_AT_LEAST") return (state.resources?.[requirement.ref]?.current ?? 0) >= requirement.value;
    return false;
  });
  return deepFreeze({ satisfied, attempted_effects: satisfied ? deepClone(contract.on_satisfied ?? []) : [], violation_attempts: satisfied ? [] : deepClone(contract.on_violation ?? []) });
}
