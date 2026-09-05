import { deepClone, deepFreeze } from "../utils.js";
import { semanticError } from "./errors.js";
import { validateSemanticSchema } from "./schemas.js";

const FORBIDDEN = new Set(["damage", "final_damage", "health_damage", "hit", "hit_outcome", "critical", "defense_result", "defense_outcome", "status_applied", "incapacitated", "success", "strategy_success", "final_state", "state_delta", "resource_outcome"]);

export function assertSemanticAuthority(value, path = "intent") {
  if (!value || typeof value !== "object") return true;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(key.toLowerCase())) throw semanticError("FALLBACK_VALIDATION_ERROR", `Semantic data cannot declare mechanical outcome field ${key}.`, `${path}.${key}`);
    assertSemanticAuthority(child, `${path}.${key}`);
  }
  return true;
}

export function validateSemanticIntent(intent, context = {}) {
  validateSemanticSchema("intent", intent);
  assertSemanticAuthority(intent);
  const entityIds = new Set((context.entities ?? []).map((entity) => entity.id));
  const targets = [];
  if (intent.action) targets.push(...intent.action.targets.map((target) => target.entity_id));
  if (intent.ability_use) targets.push(...intent.ability_use.targets.filter((target) => target.type === "character").map((target) => target.ref));
  for (const step of intent.sequence ?? intent.strategy?.steps ?? []) {
    if (step.action) targets.push(...step.action.targets.map((target) => target.entity_id));
    if (step.ability_use) targets.push(...step.ability_use.targets.filter((target) => target.type === "character").map((target) => target.ref));
  }
  if (entityIds.size) for (const target of targets) if (!entityIds.has(target) && target !== intent.actor_id) throw semanticError("INVALID_ENTITY", `Semantic target ${target} is not present in context.`, "target");
  const abilityUses = [intent.ability_use, ...(intent.sequence ?? []).map((step) => step.ability_use), ...(intent.strategy?.steps ?? []).map((step) => step.ability_use)].filter(Boolean);
  if (context.abilityRegistry) for (const use of abilityUses) if (!context.abilityRegistry.has(use.ability_id)) throw semanticError("UNKNOWN_ABILITY", `Unknown registered ability ${use.ability_id}.`, "ability_id");
  return deepFreeze(deepClone(intent));
}
