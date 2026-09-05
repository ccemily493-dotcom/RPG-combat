import { canonicalHash, deepFreeze } from "../utils.js";
import { fieldConfidence, overallConfidence } from "./confidence.js";
import { resolveSemanticEntities } from "./entities.js";
import { semanticError } from "./errors.js";
import { matchDictionary } from "./matcher.js";
import { defaultExecutionClass, STRATEGIC_PRIMITIVES } from "./taxonomy.js";

const ZONES = Object.freeze([
  { pattern: /\b(?:pierna|piernas|leg|legs)\b/iu, zone: "LEG" }, { pattern: /\b(?:brazo|brazos|arm|arms)\b/iu, zone: "ARM" },
  { pattern: /\b(?:cabeza|head)\b/iu, zone: "HEAD" }, { pattern: /\b(?:torso|pecho|chest)\b/iu, zone: "TORSO" }
]);
const DIRECTIONS = Object.freeze([
  { pattern: /\b(?:detrás|detras|behind)\b/iu, value: "BEHIND" }, { pattern: /\b(?:izquierda|left)\b/iu, value: "LEFT" },
  { pattern: /\b(?:derecha|right)\b/iu, value: "RIGHT" }, { pattern: /\b(?:hacia|toward|towards)\b/iu, value: "TOWARD" },
  { pattern: /\b(?:lejos|away)\b/iu, value: "AWAY" }
]);
const INTENSITIES = Object.freeze([
  { pattern: /\b(?:con toda mi fuerza|full force)\b/iu, value: "MAX" }, { pattern: /\b(?:fuerte|hard)\b/iu, value: "HIGH" },
  { pattern: /\b(?:suave|softly)\b/iu, value: "LOW" }, { pattern: /\b(?:rápido|rapido|quickly|fast)\b/iu, value: "FAST" },
  { pattern: /\b(?:despacio|slowly|carefully|con cuidado)\b/iu, value: "CAREFUL" }
]);
const NUMBER_WORDS = Object.freeze({ uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 });

function quantity(text) { const digit = text.match(/\b(\d+)\s*(?:veces|times|shots|disparos)?\b/iu); if (digit) return Math.max(1, Number(digit[1])); for (const [word, value] of Object.entries(NUMBER_WORDS)) if (new RegExp(`\\b${word}\\b`, "iu").test(text)) return value; return 1; }
function distance(text) {
  const match = text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:m|metro|metros|meter|meters)\b/iu);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function semanticAction(match, entityResult, text) {
  const entry = match.candidates[0];
  return {
    type: entry.canonical_type, subtype: entry.canonical_subtype ?? null,
    targets: entityResult.targets.map(({ entity_id, source_span }) => ({ entity_id, source_span })),
    target_zone: ZONES.find((item) => item.pattern.test(text))?.zone ?? null,
    direction: DIRECTIONS.find((item) => item.pattern.test(text))?.value ?? null,
    distance: distance(text), intensity: INTENSITIES.find((item) => item.pattern.test(text))?.value ?? null,
    quantity: quantity(text), object_ref: entry.canonical_subtype === "THROW_OBJECT" ? "declared_object" : null,
    execution_class: defaultExecutionClass(entry.canonical_type), primitive: STRATEGIC_PRIMITIVES.includes(entry.canonical_type) ? entry.canonical_type : null
  };
}

function stepFromMatch(match, index, action, actorId, turn) {
  const entry = match.candidates[0];
  if (entry.ability_id) return { step_id: `step_${index + 1}`, kind: "ABILITY_USE", ability_use: { ability_id: entry.ability_id, actor_id: actorId, targets: action.targets.map((target) => ({ type: "character", ref: target.entity_id, position: null, body_zone: action.target_zone })), parameters: {}, declared_options: { turn } }, execution_class: "ACTION", depends_on: index ? [`step_${index}`] : [] };
  return { step_id: `step_${index + 1}`, kind: STRATEGIC_PRIMITIVES.includes(entry.canonical_type) ? "PRIMITIVE" : "ACTION", action, primitive: STRATEGIC_PRIMITIVES.includes(entry.canonical_type) ? entry.canonical_type : null, execution_class: action.execution_class, depends_on: index ? [`step_${index}`] : [] };
}

export function parseWithRules(normalization, dictionary, context = {}, config = null) {
  const text = normalization.original_text;
  const negated = /^\s*(?:no|do not|don't)\b/iu.test(text) && !/[,;…]\s*(?:no|not)\b/iu.test(text);
  if (negated) return { intent: null, negated: true, matches: [], entityResult: { targets: [], ambiguity: null, evidence: "missing" }, ruleIds: ["negation.basic"] };
  const matches = matchDictionary(normalization, dictionary);
  const maximumSteps = config?.spec?.limits?.maximum_sequence_steps?.value ?? 16;
  if (matches.length > maximumSteps) throw semanticError("INTENT_SCHEMA_ERROR", `Semantic sequence exceeds ${maximumSteps} steps.`, "sequence");
  const entityResult = resolveSemanticEntities(normalization, context);
  if (!matches.length) return { intent: null, negated: false, matches, entityResult, ruleIds: [] };
  const actorId = context.actorId ?? null;
  const turn = context.world?.turn ?? 0;
  const actions = matches.map((match) => semanticAction(match, entityResult, text));
  const steps = matches.map((match, index) => stepFromMatch(match, index, actions[index], actorId, turn));
  const abilityOnly = steps.length === 1 && steps[0].kind === "ABILITY_USE";
  const strategyMarker = /\b(?:para|so that|in order to|if|si|cuando|when)\b/iu.test(text) || steps.some((step) => step.kind === "PRIMITIVE");
  const intentType = abilityOnly ? "ABILITY_USE" : steps.length > 1 ? (strategyMarker ? "STRATEGY" : "SEQUENCE") : ["WAIT", "OBSERVE"].includes(actions[0].type) ? actions[0].type : "ACTION";
  const targetConfidence = actions.some((action) => action.targets.length) ? fieldConfidence(entityResult.evidence, config) : 0.8;
  const confidence = { intent_type: fieldConfidence("rule_pattern", config), action: fieldConfidence("normalized_dictionary", config), target: targetConfidence };
  if (actions[0]?.subtype) confidence.subtype = fieldConfidence("normalized_dictionary", config);
  const provenance = { parser_version: "0.5.0", parser_path: "RULE", locale: context.locale ?? dictionary.locale ?? "und", dictionary_hash: dictionary.hash, rule_ids: [strategyMarker ? "structure.strategy" : steps.length > 1 ? "structure.sequence" : "structure.single"], dictionary_entries: matches.map((match) => match.candidates[0].entry_id), fallback_provider_id: null, cache_status: "MISS", source_spans: matches.map((match) => match.source_span) };
  const base = { intent_id: context.intentId ?? `semantic:${canonicalHash({ text, actorId, turn }).slice(0, 16)}`, intent_type: intentType, actor_id: actorId, locale: context.locale ?? dictionary.locale ?? "und", original_text: text, normalized_text: normalization.normalized_text, confidence: { ...confidence, overall: overallConfidence(confidence) }, provenance };
  if (intentType === "ABILITY_USE") base.ability_use = steps[0].ability_use;
  else if (intentType === "STRATEGY") base.strategy = { strategy_id: `${base.intent_id}:strategy`, owner: actorId, steps };
  else if (intentType === "SEQUENCE") base.sequence = steps;
  else if (intentType === "ACTION") base.action = actions[0];
  return { intent: deepFreeze(base), negated: false, matches, entityResult, ruleIds: provenance.rule_ids };
}
