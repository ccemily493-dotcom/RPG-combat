import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deepClone } from "./utils.js";

function resetEconomy(character, actions = 1, reactions = 1) {
  character.action_economy = {
    available: actions > 0,
    reaction_available: reactions > 0,
    committed_until_turn: 0,
    action_capacity: actions,
    actions_remaining: actions,
    actions_reserved: 0,
    reaction_capacity: reactions,
    reactions_remaining: reactions,
    reactions_reserved: 0
  };
  return character;
}

function cloneCharacter(character, id, position, { actions = 1, reactions = 1 } = {}) {
  const result = resetEconomy(deepClone(character), actions, reactions);
  result.id = id;
  result.name = id;
  result.transform.position = { x: position, y: 0, z: 0 };
  result.resources.health = { current: 1000, maximum: 1000 };
  result.resources.stability = { current: 1000, maximum: 1000 };
  result.resources.energy = { current: 1000, maximum: 1000 };
  result.statuses = [];
  return result;
}

function target(ref, bodyZone = "core") {
  return { type: "character", ref, position: null, body_zone: bodyZone };
}

function attackAction(template, { id, actorId, targets, quantity = 1, targetingMode = "SINGLE", allocations = [], power = 8, energyCost = 4, costMode = "PER_ACTION", perHitAmount = 0, statuses = [], effects = {}, interruptResistance = 0 }) {
  const action = deepClone(template);
  action.id = id;
  action.actor_id = actorId;
  action.phase = "declared";
  action.targets = targets.map((idValue) => target(idValue));
  action.attack.power = power;
  action.attack.quantity = quantity;
  action.attack.targeting = { mode: targetingMode, allocations };
  action.attack.status_effects = statuses;
  action.attack.interrupt_resistance = interruptResistance;
  action.attack.batch_safety = "AUTO";
  action.defense = null;
  action.costs = [{
    resource: "energy",
    amount: energyCost,
    timing: "on_attempt",
    mode: costMode,
    ...(costMode === "UPFRONT_PLUS_PER_HIT" ? { upfront_amount: energyCost, per_hit_amount: perHitAmount } : {})
  }];
  action.modifiers = [];
  action.depends_on = [];
  action.effects = { displacements: [], status_removals: [], ...effects };
  action.tags = [];
  action.extension_payload = {};
  return action;
}

function interactionAction(template, { id, actorId, targetId, displacement }) {
  const action = deepClone(template);
  action.id = id;
  action.actor_id = actorId;
  action.kind = "interaction";
  action.phase = "declared";
  action.targets = [target(targetId)];
  action.attack = null;
  action.defense = null;
  action.movement = null;
  action.strategy = null;
  action.costs = [];
  action.modifiers = [];
  action.tags = [];
  action.depends_on = [];
  action.effects = { displacements: [displacement], status_removals: [] };
  action.extension_payload = {};
  return action;
}

function defenseReaction({ id, reactorId, actionId, scope = "ONE_HIT", hitIndices, maximumHits, targetRefs, actionEconomyCost = 1 }) {
  return {
    id,
    reactor_id: reactorId,
    target_action_id: actionId,
    trigger: "HIT_PENDING",
    method: "block",
    timing: { latency_seconds: 0.05, priority: 0, chain_depth: 0 },
    cost: { resource: "energy", amount: 3 },
    action_economy_cost: actionEconomyCost,
    coverage: {
      scope,
      ...(hitIndices ? { hit_indices: hitIndices } : {}),
      ...(maximumHits ? { maximum_hits: maximumHits } : {}),
      ...(targetRefs ? { target_refs: targetRefs } : {})
    },
    defense: { source_ref: "shield.basic", declared_coverage: 0.9 },
    effect: { kind: "DEFEND" },
    tags: []
  };
}

function interruptReaction({ id, reactorId, actionId, consequence = "CANCEL_ACTION", potency = 10 }) {
  return {
    id,
    reactor_id: reactorId,
    target_action_id: actionId,
    trigger: "ACTION_DECLARED",
    method: "counter",
    timing: { latency_seconds: 0.05, priority: 10, chain_depth: 0 },
    cost: { resource: "energy", amount: 2 },
    action_economy_cost: 1,
    coverage: { scope: "ENTIRE_ACTION" },
    defense: null,
    effect: { kind: "INTERRUPT", consequence, potency },
    tags: []
  };
}

function turnFixture(base, id, characters, actions, reactions = [], registryPatch = {}) {
  const world = deepClone(base.world);
  world.simulation_id = `combat:${id}`;
  world.entity_refs = Object.keys(characters).sort();
  world.modifiers = [];
  const registries = deepClone(base.registries);
  Object.assign(registries.status_definitions, registryPatch.status_definitions ?? {});
  return { id, world, characters, actions, reactions, registries, seed: `seed:${id}`, trace: true };
}

export function buildCombatScenarios(reference) {
  const a = cloneCharacter(reference.actor, "a", 0, { actions: 2, reactions: 2 });
  const b = cloneCharacter(reference.target, "b", 5, { actions: 2, reactions: 2 });
  const c = cloneCharacter(reference.target, "c", 6, { actions: 2, reactions: 2 });
  const d = cloneCharacter(reference.target, "d", 7, { actions: 2, reactions: 2 });
  const template = reference.action;
  const marked = { status_id: "marked", potency: 100, duration_turns: 3, stacking_rule: "intensify" };
  const statusDefinitions = {
    marked: { channel: "kinetic", merge_policy: "stack", priority: 0, max_stacks: 5, intensity_cap: 500, duration_cap: 10, batch_aggregation: "none", tags: ["marker"] }
  };

  const scenarios = {};
  const actionA = attackAction(template, { id: "A.attack", actorId: "a", targets: ["b"] });
  scenarios.A = turnFixture(reference, "A", { a: deepClone(a), b: deepClone(b) }, [actionA], [defenseReaction({ id: "A.block", reactorId: "b", actionId: actionA.id, targetRefs: ["b"] })]);

  const actionB = attackAction(template, { id: "B.volley", actorId: "a", targets: ["b"], quantity: 5, costMode: "UPFRONT_PLUS_PER_HIT", energyCost: 2, perHitAmount: 1 });
  scenarios.B = turnFixture(reference, "B", { a: deepClone(a), b: deepClone(b) }, [actionB]);

  const actionC = attackAction(template, { id: "C.batch", actorId: "a", targets: ["b"], quantity: 500, energyCost: 20, costMode: "SHARED_POOL" });
  scenarios.C = turnFixture(reference, "C", { a: deepClone(a), b: deepClone(b) }, [actionC]);

  const actionD = attackAction(template, {
    id: "D.multi", actorId: "a", targets: ["b", "c", "d"], quantity: 6, targetingMode: "DISTRIBUTED",
    allocations: [{ target_ref: "b", quantity: 1 }, { target_ref: "c", quantity: 2 }, { target_ref: "d", quantity: 3 }],
    energyCost: 2, costMode: "PER_HIT"
  });
  scenarios.D = turnFixture(reference, "D", { a: deepClone(a), b: deepClone(b), c: deepClone(c), d: deepClone(d) }, [actionD]);

  const actionEa = attackAction(template, { id: "E.a-attacks", actorId: "a", targets: ["b"] });
  const actionEb = attackAction(template, { id: "E.b-attacks", actorId: "b", targets: ["a"] });
  scenarios.E = turnFixture(reference, "E", { a: deepClone(a), b: deepClone(b) }, [actionEa, actionEb]);

  const actionF = attackAction(template, { id: "F.attack", actorId: "a", targets: ["b"] });
  scenarios.F = turnFixture(reference, "F", { a: deepClone(a), b: deepClone(b) }, [actionF], [defenseReaction({ id: "F.block", reactorId: "b", actionId: actionF.id, targetRefs: ["b"] })]);

  const actionG = attackAction(template, { id: "G.volley", actorId: "a", targets: ["b"], quantity: 5 });
  scenarios.G = turnFixture(reference, "G", { a: deepClone(a), b: deepClone(b) }, [actionG], [
    defenseReaction({ id: "G.block-1", reactorId: "b", actionId: actionG.id, targetRefs: ["b"] }),
    defenseReaction({ id: "G.block-2", reactorId: "b", actionId: actionG.id, targetRefs: ["b"] }),
    defenseReaction({ id: "G.block-3", reactorId: "b", actionId: actionG.id, targetRefs: ["b"] })
  ]);

  const actionH = attackAction(template, { id: "H.attack", actorId: "a", targets: ["b"], interruptResistance: 5 });
  scenarios.H = turnFixture(reference, "H", { a: deepClone(a), b: deepClone(b) }, [actionH], [interruptReaction({ id: "H.interrupt", reactorId: "b", actionId: actionH.id })]);

  const actionIa = attackAction(template, { id: "I.a-status", actorId: "a", targets: ["d"], statuses: [marked] });
  const actionIb = attackAction(template, { id: "I.b-status", actorId: "b", targets: ["d"], statuses: [marked] });
  scenarios.I = turnFixture(reference, "I", { a: deepClone(a), b: deepClone(b), d: deepClone(d) }, [actionIa, actionIb], [], { status_definitions: statusDefinitions });

  const actionJa = interactionAction(template, { id: "J.left", actorId: "a", targetId: "d", displacement: { target_ref: "d", mode: "ASSIGN", vector: { x: 10, y: 0, z: 0 }, priority: 0, requires_contact: false } });
  const actionJb = interactionAction(template, { id: "J.right", actorId: "b", targetId: "d", displacement: { target_ref: "d", mode: "ASSIGN", vector: { x: -10, y: 0, z: 0 }, priority: 0, requires_contact: false } });
  scenarios.J = turnFixture(reference, "J", { a: deepClone(a), b: deepClone(b), d: deepClone(d) }, [actionJa, actionJb]);

  const poorA = deepClone(a);
  poorA.resources.energy.current = 10;
  const actionK = attackAction(template, { id: "K.expensive", actorId: "a", targets: ["b"], quantity: 5, energyCost: 5, costMode: "PER_HIT" });
  scenarios.K = turnFixture(reference, "K", { a: poorA, b: deepClone(b) }, [actionK]);

  const actionL = attackAction(template, { id: "L.status-volley", actorId: "a", targets: ["b"], quantity: 30, statuses: [marked] });
  scenarios.L = turnFixture(reference, "L", { a: deepClone(a), b: deepClone(b) }, [actionL], [], { status_definitions: statusDefinitions });

  return { version: "0.3", scenarios };
}

export async function loadCombatScenarios(specDir) {
  return JSON.parse(await readFile(join(specDir, "fixtures", "combat-scenarios.json"), "utf8"));
}
