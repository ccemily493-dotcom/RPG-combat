import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTemporalState } from "./temporal.js";
import { deepClone } from "./utils.js";

function emptyEffects() {
  return { on_success: [], on_failure: [], on_completion: [] };
}

function node(id, kind, options = {}) {
  return {
    id,
    kind,
    state: "PENDING",
    dependency_mode: options.dependency_mode ?? "ALL_OF",
    dependencies: options.dependencies ?? [],
    conditions: options.conditions ?? [],
    failure_policy: options.failure_policy ?? "CONTINUE",
    fallback_node_ids: options.fallback_node_ids ?? [],
    completion_rule: options.completion_rule ?? (kind === "CONDITION" ? "CONDITION_TRUE" : "RESOLVED"),
    effects: options.effects ?? emptyEffects(),
    ...(options.action ? { action: options.action } : {}),
    ...(options.primitive ? { primitive: options.primitive } : {}),
    ...(options.condition ? { condition: options.condition } : {})
  };
}

function strategy(id, owner, nodes) {
  return { strategy_id: id, owner, state: "ACTIVE", nodes, metadata: { fixture: true } };
}

function duration(type, remaining = null, extra = {}) {
  return { type, ...(remaining === null ? {} : { remaining }), ...extra };
}

function characterModifier(id, target, value, sourceRef = "fixture") {
  return { id, layer: "CHARACTER", target, operation: "additive", value, priority: 0, source_ref: sourceRef };
}

function worldModifier(id, target, value, sourceRef = "fixture") {
  return { id, layer: "WORLD", target, operation: "additive", value, priority: 0, source_ref: sourceRef };
}

function modifierEffect(scope, targetRef, modifier, effectDuration) {
  return { type: "ADD_MODIFIER", scope, target_ref: targetRef, modifier, duration: effectDuration };
}

function relation(id, subjectRef, objectRef, relationDuration, modifiers = [], consumption = "NEVER", kind = "CUSTOM_CORE") {
  return { id, kind, subject_ref: subjectRef, object_ref: objectRef, source_ref: "fixture", duration: relationDuration, consumption, modifiers, created_turn: 0, consumed: false, tags: [] };
}

function relationEffect(value, relationValue) {
  return { type: "ADD_RELATION", relation: relationValue, ...value };
}

function opportunity(id, kind, ownerRef, targetRef, trigger, effects, opportunityDuration, consumption = "ON_TRIGGER", reactionTemplate = null) {
  return {
    id, kind, source_ref: "fixture", owner_ref: ownerRef, target_ref: targetRef, trigger, effects,
    reaction_template: reactionTemplate, duration: opportunityDuration, consumption,
    created_turn: 0, trigger_count: 0, consumed: false, tags: []
  };
}

function opportunityEffect(value) {
  return { type: "CREATE_OPPORTUNITY", opportunity: value };
}

function scheduledEffect(id, activation, effects) {
  return {
    type: "SCHEDULE_EFFECT",
    scheduled_effect: { id, source_ref: "fixture", target_ref: null, activation, effects, priority: 0, created_turn: 0, activated: false }
  };
}

function baseSnapshot(combatScenario, id, strategies = []) {
  const snapshot = {
    world: deepClone(combatScenario.world),
    characters: deepClone(combatScenario.characters),
    temporal_state: createTemporalState(),
    strategies: deepClone(strategies)
  };
  snapshot.world.simulation_id = `session:${id}`;
  snapshot.world.turn = 0;
  snapshot.world.time.elapsed_seconds = 0;
  for (const character of Object.values(snapshot.characters)) {
    character.resources.health.current = character.resources.health.maximum;
    character.resources.stability.current = character.resources.stability.maximum;
    character.resources.energy.current = character.resources.energy.maximum;
    character.cooldowns = {};
    character.statuses = [];
    character.action_economy.action_capacity = 4;
    character.action_economy.actions_remaining = 4;
    character.action_economy.reaction_capacity = 2;
    character.action_economy.reactions_remaining = 2;
  }
  return snapshot;
}

function attack(template, id, turn, actorId = "a", targetId = "b", options = {}) {
  const action = deepClone(template);
  action.id = id;
  action.turn = turn;
  action.actor_id = actorId;
  action.targets = [{ type: "character", ref: targetId, position: null, body_zone: "core" }];
  action.attack.power = options.power ?? 8;
  action.attack.quantity = 1;
  action.attack.targeting = { mode: "SINGLE", allocations: [] };
  action.attack.status_effects = [];
  action.defense = null;
  action.costs = [{ resource: "energy", amount: options.cost ?? 1, timing: "on_attempt", mode: "PER_ACTION" }];
  action.modifiers = [];
  action.depends_on = [];
  action.effects = { displacements: [], status_removals: [] };
  action.tags = [];
  action.cooldown = options.cooldown ?? null;
  return action;
}

function movement(template, id, turn, destination) {
  const action = deepClone(template);
  action.id = id;
  action.turn = turn;
  action.actor_id = "a";
  action.kind = "movement";
  action.targets = [{ type: "self", ref: "a", position: null, body_zone: null }];
  action.attack = null;
  action.defense = null;
  action.movement = { destination, mode: "run", maximum_distance: 10 };
  action.strategy = null;
  action.costs = [];
  action.modifiers = [];
  action.depends_on = [];
  action.effects = { displacements: [], status_removals: [] };
  action.tags = [];
  action.cooldown = null;
  return action;
}

function declarations(actions = [], reactions = []) {
  return { actions, reactions };
}

function session(id, initialSnapshot, registries, steps) {
  return { id, initial_snapshot: initialSnapshot, registries: deepClone(registries), seed: `session-seed:${id}`, trace: true, steps };
}

function primitive(id, actorRef = "a", targetRef = "b", adjustments = {}) {
  return { id, actor_ref: actorRef, target_ref: targetRef, attention_channel: "visual", ...adjustments };
}

function eventTrigger(type, actorRef = null) {
  return { event_occurred: { type, ...(actorRef ? { actor_ref: actorRef } : {}) } };
}

function reactionTemplate(source) {
  const result = deepClone(source);
  delete result.target_action_id;
  result.id = "H.prepared-block";
  result.reactor_id = "a";
  result.coverage.target_refs = ["a"];
  return result;
}

export function buildSessionScenarios(combatScenarios) {
  const base = combatScenarios.A;
  const template = base.actions[0];
  const registries = base.registries;
  const scenarios = {};

  const persistent = strategy("A.persistence", "a", [node("A.opening", "STATE_TRANSITION", {
    effects: { ...emptyEffects(), on_success: [modifierEffect("CHARACTER", "a", characterModifier("A.accuracy", "attack.accuracy", 18), duration("TURN", 1))] }
  })]);
  scenarios.A = session("A-persistent-modifier", baseSnapshot(base, "A", [persistent]), registries, [
    { declarations: declarations(), seed: "A:0" },
    { declarations: declarations([attack(template, "A.attack-benefit", 1)]), seed: "A:1" },
    { declarations: declarations([attack(template, "A.attack-expired", 2)]), seed: "A:2" }
  ]);

  const cooldownAction = attack(template, "B.cooldown-action", 0, "a", "b", { cooldown: { key: "B.shared", duration: 2, unit: "TURN", starts: "ON_USE" } });
  scenarios.B = session("B-cooldown", baseSnapshot(base, "B"), registries, [
    { declarations: declarations([cooldownAction]), seed: "B:0" },
    { declarations: declarations([attack(template, "B.retry-blocked", 1, "a", "b", { cooldown: { key: "B.shared", duration: 2, unit: "TURN", starts: "ON_USE" } })]), seed: "B:1", expected_error: "cooldown" },
    { declarations: declarations(), seed: "B:1-progress" },
    { declarations: declarations([attack(template, "B.retry-ready", 2, "a", "b", { cooldown: { key: "B.shared", duration: 2, unit: "TURN", starts: "ON_USE" } })]), seed: "B:2" }
  ]);

  const delayed = strategy("C.delayed", "a", [node("C.schedule", "STATE_TRANSITION", {
    effects: { ...emptyEffects(), on_success: [scheduledEffect("C.next-turn", { type: "TURN", turn: 1 }, [
      modifierEffect("CHARACTER", "a", characterModifier("C.delayed-accuracy", "attack.accuracy", 12), duration("TURN", 1))
    ])] }
  })]);
  scenarios.C = session("C-delayed-effect", baseSnapshot(base, "C", [delayed]), registries, [
    { declarations: declarations(), seed: "C:0" },
    { declarations: declarations([attack(template, "C.attack", 1)]), seed: "C:1" }
  ]);

  const blindSpot = relation("D.blind-spot", "a", "b", duration("TURN", 2), [{
    actor_ref: "a", target_ref: "b", action_kind: "attack",
    modifier: { id: "accuracy", layer: "ACTION", target: "attack.accuracy", operation: "additive", value: 20, priority: 0, source_ref: "D.blind-spot" }
  }], "ON_SUCCESS", "BLIND_SPOT");
  const plan = strategy("D.plan", "a", [
    node("D.distraction", "PRIMITIVE", {
      primitive: primitive("DISTRACTION", "a", "b", { actor_adjustment: 30 }),
      effects: { ...emptyEffects(), on_success: [modifierEffect("CHARACTER", "b", characterModifier("D.attention", "defense.avoidance", -12), duration("TURN", 2))] }
    }),
    node("D.reposition", "PRIMITIVE", {
      dependencies: [{ node_id: "D.distraction", when: "ON_SUCCESS" }],
      primitive: primitive("REPOSITION"), action: movement(template, "D.move", 0, { x: 2, y: 2, z: 0 }),
      effects: { ...emptyEffects(), on_success: [relationEffect({}, blindSpot)] }
    }),
    node("D.attack", "ACTION", {
      dependencies: [{ node_id: "D.reposition", when: "ON_SUCCESS" }],
      action: attack(template, "D.payoff", 0), completion_rule: "RESOLVED"
    })
  ]);
  scenarios.D = session("D-distraction-reposition-attack", baseSnapshot(base, "D", [plan]), registries, [
    { declarations: declarations(), seed: "D:0" }, { declarations: declarations(), seed: "D:1" }, { declarations: declarations(), seed: "D:2" }
  ]);

  const failedPlan = deepClone(plan);
  failedPlan.strategy_id = "E.failed-plan";
  failedPlan.nodes[0].id = "E.distraction";
  failedPlan.nodes[0].primitive.actor_adjustment = -100;
  failedPlan.nodes[0].failure_policy = "CANCEL_BRANCH";
  failedPlan.nodes[1].id = "E.reposition";
  failedPlan.nodes[1].dependencies[0].node_id = "E.distraction";
  failedPlan.nodes[1].action.id = "E.move";
  failedPlan.nodes[2].id = "E.attack";
  failedPlan.nodes[2].dependencies[0].node_id = "E.reposition";
  failedPlan.nodes[2].action.id = "E.payoff";
  scenarios.E = session("E-failed-distraction", baseSnapshot(base, "E", [failedPlan]), registries, [
    { declarations: declarations(), seed: "E:0" }, { declarations: declarations(), seed: "E:1" }
  ]);

  const branch = (id, passed) => strategy(id, "a", [
    node(`${id}.root`, "CONDITION", { condition: { compare: { left: 1, operator: "eq", right: passed ? 1 : 0 } } }),
    node(`${id}.success`, "STATE_TRANSITION", { dependencies: [{ node_id: `${id}.root`, when: "ON_SUCCESS" }] }),
    node(`${id}.failure`, "STATE_TRANSITION", { dependencies: [{ node_id: `${id}.root`, when: "ON_FAILURE" }] })
  ]);
  scenarios.F = session("F-strategy-branches", baseSnapshot(base, "F", [branch("F.pass", true), branch("F.fail", false)]), registries, [
    { declarations: declarations(), seed: "F:0" }, { declarations: declarations(), seed: "F:1" }
  ]);

  const bait = strategy("G.bait", "a", [node("G.setup", "PRIMITIVE", {
    primitive: primitive("BAIT"),
    effects: { ...emptyEffects(), on_success: [opportunityEffect(opportunity("G.opportunity", "BAIT", "a", "b", eventTrigger("action_declared", "b"), [
      { type: "RESOURCE_DELTA", target_ref: "b", resource: "energy", amount: -7 }
    ], duration("TURN", 3)))] }
  })]);
  scenarios.G = session("G-bait", baseSnapshot(base, "G", [bait]), registries, [
    { declarations: declarations(), seed: "G:0" }, { declarations: declarations(), seed: "G:1" },
    { declarations: declarations([attack(template, "G.trigger", 2, "b", "a")]), seed: "G:2" }
  ]);

  const counter = strategy("H.counter", "a", [node("H.setup", "PRIMITIVE", {
    primitive: primitive("COUNTER_SETUP"),
    effects: { ...emptyEffects(), on_success: [opportunityEffect(opportunity("H.opportunity", "COUNTER_SETUP", "a", "b", eventTrigger("action_declared", "b"), [], duration("TURN", 2), "ON_SUCCESS", reactionTemplate(base.reactions[0])))] }
  })]);
  scenarios.H = session("H-counter-setup", baseSnapshot(base, "H", [counter]), registries, [
    { declarations: declarations(), seed: "H:0" },
    { declarations: declarations([attack(template, "H.incoming", 1, "b", "a")]), seed: "H:1" }
  ]);

  const trap = strategy("I.trap", "a", [node("I.setup", "PRIMITIVE", {
    primitive: primitive("TRAP"),
    effects: { ...emptyEffects(), on_success: [opportunityEffect(opportunity("I.world-trap", "TRAP", "a", "b", eventTrigger("action_declared", "b"), [
      { type: "RESOURCE_DELTA", target_ref: "b", resource: "stability", amount: -9 }
    ], duration("TURN", 3)))] }
  })]);
  const trapTriggerMovement = movement(template, "I.trigger-move", 2, { x: 1, y: 0, z: 0 });
  trapTriggerMovement.actor_id = "b";
  trapTriggerMovement.targets = [{ type: "self", ref: "b", position: null, body_zone: null }];
  scenarios.I = session("I-trap", baseSnapshot(base, "I", [trap]), registries, [
    { declarations: declarations(), seed: "I:0" }, { declarations: declarations(), seed: "I:1" },
    { declarations: declarations([trapTriggerMovement]), seed: "I:2" }
  ]);

  const denial = strategy("J.denial", "a", [node("J.setup", "PRIMITIVE", {
    primitive: primitive("AREA_DENIAL", "a", null),
    effects: { ...emptyEffects(), on_success: [modifierEffect("WORLD", null, worldModifier("J.area", "attack.accuracy", -15), duration("TURN", 1))] }
  })]);
  scenarios.J = session("J-area-denial", baseSnapshot(base, "J", [denial]), registries, [
    { declarations: declarations(), seed: "J:0" }, { declarations: declarations([attack(template, "J.affected", 1, "b", "a")]), seed: "J:1" }
  ]);

  const kSnapshot = baseSnapshot(base, "K");
  kSnapshot.temporal_state.relations = [
    relation("K.action", "a", "b", duration("ACTION", 1)),
    relation("K.condition", "a", "b", duration("UNTIL_CONDITION", null, { condition: { compare: { left: 1, operator: "eq", right: 1 } } })),
    relation("K.permanent", "a", "b", duration("PERMANENT")),
    relation("K.phase", "a", "b", duration("PHASE", 1, { phase: "TURN_END" })),
    relation("K.reaction", "a", "b", duration("REACTION_WINDOW", 1)),
    relation("K.triggered", "a", "b", duration("UNTIL_TRIGGERED", null, { trigger: "action_resolved" })),
    relation("K.turn", "a", "b", duration("TURN", 1))
  ];
  const kAction = attack(template, "K.attack", 0);
  const kReaction = deepClone(base.reactions[0]);
  kReaction.id = "K.block";
  kReaction.target_action_id = kAction.id;
  scenarios.K = session("K-duration-expiration", kSnapshot, registries, [{ declarations: declarations([kAction], [kReaction]), seed: "K:0" }]);

  const simultaneousA = strategy("L.alpha", "a", [node("L.alpha.setup", "STATE_TRANSITION", {
    effects: { ...emptyEffects(), on_success: [modifierEffect("CHARACTER", "b", characterModifier("L.alpha.mod", "defense.avoidance", -3), duration("TURN", 2))] }
  })]);
  const simultaneousB = strategy("L.beta", "b", [node("L.beta.setup", "STATE_TRANSITION", {
    effects: { ...emptyEffects(), on_success: [modifierEffect("CHARACTER", "b", characterModifier("L.beta.mod", "defense.avoidance", -4), duration("TURN", 2))] }
  })]);
  scenarios.L = session("L-simultaneous-strategies", baseSnapshot(base, "L", [simultaneousB, simultaneousA]), registries, [{ declarations: declarations(), seed: "L:0" }]);

  const cycle = strategy("M.cycle", "a", [
    node("M.one", "STATE_TRANSITION", { dependencies: [{ node_id: "M.two", when: "ON_SUCCESS" }] }),
    node("M.two", "STATE_TRANSITION", { dependencies: [{ node_id: "M.one", when: "ON_SUCCESS" }] })
  ]);
  scenarios.M = session("M-cycle-rejected", baseSnapshot(base, "M", [cycle]), registries, [{ declarations: declarations(), seed: "M:0", expected_error: "cycle" }]);

  const chainNodes = Array.from({ length: 5 }, (_, index) => node(`N.node-${index + 1}`, "STATE_TRANSITION", {
    dependencies: index ? [{ node_id: `N.node-${index}`, when: "ON_SUCCESS" }] : []
  }));
  scenarios.N = session("N-five-turn-replay", baseSnapshot(base, "N", [strategy("N.chain", "a", chainNodes)]), registries,
    Array.from({ length: 5 }, (_, index) => ({ declarations: declarations(), seed: `N:${index}` })));

  return { version: "0.3", scenarios };
}

export async function loadSessionScenarios(specDir) {
  return JSON.parse(await readFile(join(specDir, "fixtures", "session-scenarios.json"), "utf8"));
}
