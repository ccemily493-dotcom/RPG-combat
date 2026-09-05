import { deepClone, deepFreeze } from "./utils.js";

export function immutableSnapshot(value) {
  return deepFreeze(deepClone(value));
}

export function immutableEncounterSnapshot({ world, actor, target, action, registries = {} }) {
  return immutableSnapshot({ world, actor, target, action, registries });
}

export function immutableTurnSnapshot({ world, characters, actions, reactions = [], registries = {}, seed }) {
  return immutableSnapshot({ world, characters, actions, reactions, registries, seed: String(seed) });
}
