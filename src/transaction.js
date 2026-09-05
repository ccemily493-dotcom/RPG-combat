import { InsufficientResourcesError, ResolutionError } from "./errors.js";
import { deepClone, deepFreeze, roundTo } from "./utils.js";

export class ActionTransaction {
  #original;
  #working;
  #reservations = new Map();
  #mutations = [];
  #closed = false;

  constructor(snapshot) {
    this.#original = snapshot;
    this.#working = {
      world: deepClone(snapshot.world),
      actor: deepClone(snapshot.actor),
      target: deepClone(snapshot.target)
    };
  }

  #assertOpen() {
    if (this.#closed) throw new ResolutionError("Action transaction is already closed.");
  }

  character(role) {
    if (role !== "actor" && role !== "target") throw new ResolutionError(`Unknown transaction role: ${role}`);
    return this.#working[role];
  }

  reserve(role, resource, amount, reason) {
    this.#assertOpen();
    if (amount < 0 || !Number.isFinite(amount)) throw new ResolutionError("Reservation must be finite and nonnegative.");
    const character = this.character(role);
    const available = character.resources[resource]?.current;
    if (!Number.isFinite(available)) throw new ResolutionError(`Unknown resource ${resource} on ${character.id}.`);
    const key = `${role}:${resource}`;
    const alreadyReserved = this.#reservations.get(key) ?? 0;
    if (available + 1e-12 < alreadyReserved + amount) {
      throw new InsufficientResourcesError(character.id, resource, alreadyReserved + amount, available);
    }
    this.#reservations.set(key, alreadyReserved + amount);
    this.#mutations.push({ type: "reserve", role, characterId: character.id, resource, amount, reason });
  }

  debit(role, resource, amount, reason) {
    this.#assertOpen();
    if (amount === 0) return;
    const character = this.character(role);
    const before = character.resources[resource].current;
    if (before + 1e-12 < amount) throw new InsufficientResourcesError(character.id, resource, amount, before);
    character.resources[resource].current = roundTo(before - amount);
    this.#mutations.push({ type: "resource", role, characterId: character.id, resource, before, after: character.resources[resource].current, delta: -amount, reason });
  }

  damage(role, amount, reason) {
    this.#assertOpen();
    if (amount === 0) return;
    const character = this.character(role);
    const resource = character.resources.health;
    const before = resource.current;
    resource.current = roundTo(Math.max(0, before - amount));
    this.#mutations.push({ type: "health", role, characterId: character.id, before, after: resource.current, delta: resource.current - before, reason });
  }

  destabilize(role, amount, reason) {
    this.#assertOpen();
    if (amount === 0) return;
    const character = this.character(role);
    const resource = character.resources.stability;
    const before = resource.current;
    resource.current = roundTo(Math.max(0, before - amount));
    this.#mutations.push({ type: "stability", role, characterId: character.id, before, after: resource.current, delta: resource.current - before, reason });
  }

  addStatus(role, status) {
    this.#assertOpen();
    const character = this.character(role);
    const existing = character.statuses.find((item) => item.id === status.id);
    if (existing && (status.stacking_rule === "reject" || status.stacking_rule === "ignore")) return;
    if (existing && status.stacking_rule === "refresh") {
      const before = existing.remaining_turns;
      existing.remaining_turns = before === null || status.remaining_turns === null
        ? null
        : Math.max(before, status.remaining_turns);
      this.#mutations.push({ type: "status_refresh", role, characterId: character.id, statusId: status.id, before, after: existing.remaining_turns });
      return;
    }
    if (existing && (status.stacking_rule === "intensify" || status.stacking_rule === "stack")) {
      const before = existing.intensity;
      existing.intensity = roundTo(before + status.intensity);
      existing.remaining_turns = existing.remaining_turns === null || status.remaining_turns === null
        ? null
        : Math.max(existing.remaining_turns, status.remaining_turns);
      this.#mutations.push({ type: "status_intensify", role, characterId: character.id, statusId: status.id, before, after: existing.intensity });
      return;
    }
    if (existing && status.stacking_rule === "replace") {
      const before = deepClone(existing);
      Object.assign(existing, deepClone(status));
      this.#mutations.push({ type: "status_replace", role, characterId: character.id, statusId: status.id, before, after: deepClone(existing) });
      return;
    }
    if (existing && status.stacking_rule === "strongest_wins") {
      const incomingDuration = status.remaining_turns === null ? Infinity : status.remaining_turns;
      const existingDuration = existing.remaining_turns === null ? Infinity : existing.remaining_turns;
      if (status.intensity < existing.intensity || (status.intensity === existing.intensity && incomingDuration <= existingDuration)) return;
      const before = deepClone(existing);
      Object.assign(existing, deepClone(status));
      this.#mutations.push({ type: "status_strongest", role, characterId: character.id, statusId: status.id, before, after: deepClone(existing) });
      return;
    }
    character.statuses.push(deepClone(status));
    this.#mutations.push({ type: "status_add", role, characterId: character.id, statusId: status.id, after: deepClone(status) });
  }

  consumeAction(role, reaction = false) {
    this.#assertOpen();
    const character = this.character(role);
    const field = reaction ? "reaction_available" : "available";
    const before = character.action_economy[field];
    const remainingField = reaction ? "reactions_remaining" : "actions_remaining";
    let availableAfter = false;
    if (Number.isInteger(character.action_economy[remainingField])) {
      const remainingBefore = character.action_economy[remainingField];
      character.action_economy[remainingField] = Math.max(0, remainingBefore - 1);
      availableAfter = character.action_economy[remainingField] > 0;
      this.#mutations.push({ type: "action_economy", role, characterId: character.id, field: remainingField, before: remainingBefore, after: character.action_economy[remainingField] });
    }
    character.action_economy[field] = availableAfter;
    this.#mutations.push({ type: "action_economy", role, characterId: character.id, field, before, after: availableAfter });
  }

  commit(worldUpdater) {
    this.#assertOpen();
    this.#closed = true;
    if (worldUpdater) this.#working.world = worldUpdater(this.#working.world, this.#mutations);
    return deepFreeze({
      world: this.#working.world,
      actor: this.#working.actor,
      target: this.#working.target,
      mutations: deepClone(this.#mutations)
    });
  }

  abort(reason) {
    this.#assertOpen();
    this.#closed = true;
    return deepFreeze({
      aborted: true,
      reason,
      world: this.#original.world,
      actor: this.#original.actor,
      target: this.#original.target,
      mutations: []
    });
  }
}

export function scaledCost(cost, { durationSeconds = 1, targetCount = 1 } = {}) {
  if (cost.timing === "per_second") return cost.amount * durationSeconds;
  if (cost.timing === "per_target") return cost.amount * targetCount;
  return cost.amount;
}

export class TurnTransaction {
  #original;
  #staged = [];
  #closed = false;

  constructor(snapshot) {
    this.#original = snapshot;
  }

  stage(delta) {
    if (this.#closed) throw new ResolutionError("Turn transaction is already closed.");
    this.#staged.push(deepClone(delta));
  }

  staged() {
    return deepFreeze(deepClone(this.#staged));
  }

  commit(apply, validate) {
    if (this.#closed) throw new ResolutionError("Turn transaction is already closed.");
    this.#closed = true;
    const working = deepClone(this.#original);
    const result = apply(working, deepClone(this.#staged));
    if (validate) validate(result);
    return deepFreeze(result);
  }

  abort(reason) {
    if (!this.#closed) this.#closed = true;
    return deepFreeze({ aborted: true, reason, snapshot: this.#original, staged: [] });
  }
}

export class TurnReservationLedger {
  #snapshot;
  #resources = new Map();
  #actions = new Map();
  #reactions = new Map();
  #records = [];

  constructor(snapshot) {
    this.#snapshot = snapshot;
  }

  reserveResource(characterId, resource, amount, reason, { optional = false } = {}) {
    if (!Number.isFinite(amount) || amount < 0) throw new ResolutionError("Turn reservation must be finite and nonnegative.");
    const character = this.#snapshot.characters[characterId];
    const available = character?.resources?.[resource]?.current;
    if (!Number.isFinite(available)) throw new ResolutionError(`Unknown resource ${resource} on ${characterId}.`);
    const key = `${characterId}\u001f${resource}`;
    const reserved = this.#resources.get(key) ?? 0;
    if (reserved + amount > available + 1e-12) {
      if (optional) return false;
      throw new InsufficientResourcesError(characterId, resource, reserved + amount, available);
    }
    this.#resources.set(key, roundTo(reserved + amount));
    this.#records.push({ type: "resource", characterId, resource, amount, totalReserved: this.#resources.get(key), reason });
    return true;
  }

  reserveAction(characterId, amount, reason) {
    const character = this.#snapshot.characters[characterId];
    const economy = character?.action_economy;
    const available = economy?.actions_remaining ?? (economy?.available ? 1 : 0);
    const reserved = this.#actions.get(characterId) ?? 0;
    if (reserved + amount > available) throw new ResolutionError(`Character ${characterId} lacks action capacity: required ${reserved + amount}, available ${available}.`);
    this.#actions.set(characterId, reserved + amount);
    this.#records.push({ type: "action_economy", characterId, amount, totalReserved: reserved + amount, reason });
  }

  reserveReaction(characterId, amount, reason) {
    const character = this.#snapshot.characters[characterId];
    const economy = character?.action_economy;
    const available = economy?.reactions_remaining ?? (economy?.reaction_available ? 1 : 0);
    const reserved = this.#reactions.get(characterId) ?? 0;
    if (reserved + amount > available) return false;
    this.#reactions.set(characterId, reserved + amount);
    this.#records.push({ type: "reaction_economy", characterId, amount, totalReserved: reserved + amount, reason });
    return true;
  }

  resourceTotal(characterId, resource) {
    return this.#resources.get(`${characterId}\u001f${resource}`) ?? 0;
  }

  actionTotal(characterId) {
    return this.#actions.get(characterId) ?? 0;
  }

  reactionTotal(characterId) {
    return this.#reactions.get(characterId) ?? 0;
  }

  records() {
    return deepFreeze(deepClone(this.#records));
  }
}
