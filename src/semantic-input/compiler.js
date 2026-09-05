import { canonicalHash, deepClone, deepFreeze } from "../utils.js";
import { instantiateAbilityUse, validateSchema as validateAbilitySchema } from "../ability-parser/index.js";
import { semanticError } from "./errors.js";
import { validateSemanticIntent } from "./validation.js";

function targetPayload(target, zoneMap = {}) {
  return { type: "character", ref: target.entity_id, position: null, body_zone: target.target_zone ? (zoneMap[target.target_zone] ?? target.target_zone.toLowerCase()) : null };
}

function templateKey(action) { return action.subtype ? `${action.type}:${action.subtype}` : action.type; }

function compileAction(action, intent, context, id) {
  const templates = context.actionTemplates ?? {};
  const template = templates[templateKey(action)] ?? templates[action.type];
  if (!template) throw semanticError("UNKNOWN_ACTION", `No explicit mechanical template exists for ${templateKey(action)}.`, "action.type");
  const normalized = deepClone(template);
  normalized.id = id;
  normalized.turn = context.world?.turn ?? normalized.turn ?? 0;
  normalized.actor_id = intent.actor_id;
  normalized.phase = "declared";
  normalized.intent_text = null;
  normalized.targets = action.targets.map((target) => targetPayload({ ...target, target_zone: action.target_zone }, context.zoneMap));
  normalized.economy_class = action.execution_class === "ZERO_TIME" ? (normalized.economy_class ?? "PASSIVE") : action.execution_class;
  normalized.extension_payload ??= {};
  if (normalized.attack) {
    normalized.attack.quantity = action.quantity;
    normalized.attack.targeting = { mode: normalized.targets.length > 1 ? "EACH_TARGET" : "SINGLE", allocations: [] };
  }
  if (normalized.movement && action.distance !== null) normalized.movement.maximum_distance = action.distance;
  validateAbilitySchema("action", normalized);
  return normalized;
}

function abilityPayload(use, context) {
  if (!context.abilityRegistry) throw semanticError("UNKNOWN_ABILITY", "Ability intent requires an ability registry.", "ability_use");
  return instantiateAbilityUse(context.abilityRegistry.get(use.ability_id), use, { characters: context.characters, world: context.world, distance: context.distance, trace: context.traceAbilityParser === true });
}

function emptyEffects() { return { on_success: [], on_partial: [], on_failure: [], on_completion: [] }; }

function actionNode(id, executionClass, dependencies, action) {
  return { id, kind: "ACTION", execution_class: executionClass, state: "PENDING", dependency_mode: "ALL_OF", dependencies: dependencies.map((node_id) => ({ node_id, when: "ON_COMPLETION" })), conditions: [], failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "RESOLVED", action, primitive: null, condition: null, effects: emptyEffects() };
}

function primitiveNode(step, actorId, targets, action = null) {
  return { id: step.step_id, kind: "PRIMITIVE", execution_class: step.execution_class, state: "PENDING", dependency_mode: "ALL_OF", dependencies: (step.depends_on ?? []).map((node_id) => ({ node_id, when: "ON_COMPLETION" })), conditions: [], failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "RESOLVED", action, primitive: { id: step.primitive, actor_ref: actorId, target_ref: targets[0]?.entity_id ?? null, attention_channel: null, actor_adjustment: 0, opposition_adjustment: 0 }, condition: null, effects: emptyEffects() };
}

function compileSteps(steps, intent, context, strategyId) {
  const nodes = [];
  for (const step of steps) {
    if (step.kind === "PRIMITIVE") {
      const actionBacked = ["REPOSITION", "INTERRUPT_SETUP"].includes(step.primitive);
      const action = actionBacked && step.action ? compileAction(step.action, intent, context, `${strategyId}:${step.step_id}`) : null;
      nodes.push(primitiveNode(step, intent.actor_id, step.action?.targets ?? [], action));
    }
    else if (step.kind === "ACTION") nodes.push(actionNode(step.step_id, step.execution_class, step.depends_on ?? [], compileAction(step.action, intent, context, `${strategyId}:${step.step_id}`)));
    else if (step.kind === "ABILITY_USE") {
      const payload = abilityPayload(step.ability_use, context);
      if (payload.strategy_fragments.length) throw semanticError("INVALID_STRATEGY", "Nested ability Strategy DAG fragments require an explicit author-provided composition rule.", `strategy.steps.${step.step_id}`);
      let previous = [...(step.depends_on ?? [])];
      for (const [index, action] of payload.actions.entries()) {
        const nodeId = payload.actions.length === 1 ? step.step_id : `${step.step_id}_${index + 1}`;
        const bound = { ...deepClone(action), id: `${strategyId}:${nodeId}` };
        nodes.push(actionNode(nodeId, bound.economy_class ?? "ACTION", previous, bound));
        previous = [nodeId];
      }
    }
  }
  return nodes;
}

export function compileSemanticIntent(intent, context = {}) {
  const valid = validateSemanticIntent(intent, context);
  let payload;
  if (valid.intent_type === "ACTION") payload = { kind: "ACTIONS", actions: [compileAction(valid.action, valid, context, `${valid.intent_id}:action`)], reactions: [] };
  else if (["WAIT", "OBSERVE"].includes(valid.intent_type)) payload = { kind: "NO_ACTION", actions: [], reactions: [] };
  else if (valid.intent_type === "ABILITY_USE") payload = { kind: "ABILITY_USE", ability_use: deepClone(valid.ability_use), ability_payload: abilityPayload(valid.ability_use, context) };
  else if (valid.intent_type === "SEQUENCE") {
    const actions = [];
    const ability_payloads = [];
    for (const step of valid.sequence) {
      if (step.action) actions.push(compileAction(step.action, valid, context, `${valid.intent_id}:${step.step_id}`));
      if (step.ability_use) ability_payloads.push(abilityPayload(step.ability_use, context));
    }
    payload = { kind: "SEQUENCE", actions, ability_payloads };
  } else if (valid.intent_type === "STRATEGY") {
    const strategy = { strategy_id: valid.strategy.strategy_id, owner: valid.strategy.owner, state: "ACTIVE", completion_policy: "ALL_TERMINAL", goals: { required: [valid.strategy.steps.at(-1).step_id], optional: [] }, metadata: { source: "semantic-input", semantic_hash: canonicalHash({ intent_type: valid.intent_type, strategy: valid.strategy }) }, nodes: compileSteps(valid.strategy.steps, valid, context, valid.strategy.strategy_id) };
    validateAbilitySchema("strategy", strategy);
    payload = { kind: "STRATEGY", strategy };
  } else throw semanticError("SEMANTIC_SCHEMA_ERROR", `Intent ${valid.intent_type} cannot compile into mechanics.`, "intent_type");
  return deepFreeze({ ...payload, semantic_provenance: deepClone(valid.provenance), semantic_intent_hash: canonicalHash(valid) });
}
