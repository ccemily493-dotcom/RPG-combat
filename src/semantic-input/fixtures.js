import { deepClone, deepFreeze } from "../utils.js";
import { abilityAliasEntries } from "./dictionary.js";
import { englishEntries } from "./locales/en.js";
import { spanishEntries } from "./locales/es.js";

export function buildSemanticDictionaryEntries(abilityRegistry = null) {
  return deepFreeze([...spanishEntries, ...englishEntries, ...abilityAliasEntries(abilityRegistry)].map((entry) => deepClone(entry)));
}

export function buildSemanticActionTemplates(referenceAction) {
  const attack = deepClone(referenceAction);
  attack.intent_text = null;
  attack.parser_trace = null;
  attack.resolution = null;
  attack.extension_payload = {};
  const movement = {
    id: "semantic.movement", turn: 0, actor_id: referenceAction.actor_id, kind: "movement", economy_class: "MOVEMENT", phase: "declared", intent_text: null,
    targets: [], timing: { declared_at: 0, duration_seconds: 1, priority: 0, interrupt_window_seconds: 0 }, attack: null, defense: null,
    movement: { destination: { x: 1, y: 0, z: 0 }, mode: "run", maximum_distance: 5 }, strategy: null, subactions: [],
    costs: [], modifiers: [], tags: ["semantic-template"], depends_on: [], effects: { displacements: [], status_removals: [] }, parser_trace: null, resolution: null, extension_payload: {}
  };
  const interaction = { ...deepClone(movement), id: "semantic.interaction", kind: "interaction", economy_class: "ACTION", movement: null };
  const map = { ATTACK: attack, "ATTACK:PUNCH": attack, "ATTACK:KICK": attack, "ATTACK:HEADBUTT": attack, "ATTACK:SHOVE": attack, "ATTACK:SLASH": attack, "ATTACK:THRUST": attack, "ATTACK:SHOT": attack, THROW: attack, MOVE: movement, RUN: movement, WALK: movement, APPROACH: movement, RETREAT: movement, REPOSITION: movement, JUMP: movement, CROUCH: movement, TURN: movement, INTERACT: interaction, USE_OBJECT: interaction, GRAB: interaction, RELEASE: interaction };
  return deepFreeze(Object.fromEntries(Object.entries(map).map(([key, value]) => [key, deepClone(value)])));
}

export function semanticEntities() {
  return deepFreeze([
    { id: "a", names: { es: ["A"], en: ["A"] }, aliases: ["actor"], tags: ["player"], position: { x: 0, y: 0, z: 0 } },
    { id: "b", names: { es: ["B"], en: ["B"] }, aliases: [], tags: ["enemy"], position: { x: 2, y: 0, z: 0 } },
    { id: "c", names: { es: ["C"], en: ["C"] }, aliases: [], tags: ["enemy"], position: { x: 4, y: 0, z: 0 } }
  ]);
}
