const c = (value) => ({ const: value });
const ref = (value) => ({ ref: value });
const op = (name, ...args) => ({ op: name, args });

function attack({ power = c(70), accuracy = c(65), speed = c(60), quantity = c(1), cost = c(10), status = [] } = {}) {
  return {
    kind: "attack",
    timing: { declared_at: 0, duration_seconds: 1, priority: 0, interrupt_window_seconds: 0.25 },
    attack: {
      delivery: "projectile", channels: { normal: 1 }, power, accuracy, speed, penetration: 0.2, range: 50,
      area: { shape: "point", dimensions: {}, falloff: "none" }, stability_impact: 10,
      status_effects: status, quantity, targeting: { mode: "SINGLE", allocations: [] }, interrupt_resistance: 0, batch_safety: "AUTO"
    },
    costs: [{ resource: "energy", amount: cost, timing: "reserve", mode: "PER_ACTION", upfront_amount: 0, per_hit_amount: 0 }],
    modifiers: [], tags: ["ability"], depends_on: [], effects: { displacements: [], status_removals: [] }, cooldown: null, extension_payload: {}
  };
}

function movement() {
  return {
    kind: "movement", timing: { declared_at: 0, duration_seconds: 0.5, priority: 0, interrupt_window_seconds: 0.1 },
    movement: { destination: { x: 3, y: 0, z: 0 }, mode: "run", maximum_distance: op("ADD", ref("actor.stats.movement"), c(1)) },
    costs: [{ resource: "energy", amount: 4, timing: "reserve", mode: "PER_ACTION", upfront_amount: 0, per_hit_amount: 0 }],
    modifiers: [], tags: ["ability", "movement"], depends_on: [], effects: { displacements: [], status_removals: [] }, cooldown: null, extension_payload: {}
  };
}

function definition(id, name, components, extra = {}) {
  return { ability_id: `core.example.${id}`, version: "1.0.0", namespace: "core", name, aliases: { en: [name] }, tags: ["example"], parameters: {}, constants: {}, requirements: [], resources: ["energy"], limitations: [], variants: {}, mechanics: { components, strategy_fragments: [] }, metadata: { fixture: true }, ...extra };
}

function component(id, template, output, executionClass = null, when = null) {
  return { id, template, output, ...(executionClass ? { execution_class: executionClass } : {}), ...(when ? { when } : {}) };
}

function strategyAction() {
  return {
    ...attack({ power: op("ADD", ref("actor.stats.physical_capability"), c(8)), cost: c(6) }),
    id: "$action.attack", turn: ref("context.current_turn"), actor_id: "$actor", phase: "declared",
    targets: [{ type: "character", ref: "$target.0", position: null, body_zone: null }], parser_trace: null, resolution: null
  };
}

export function buildGenericAbilityDefinitions() {
  const heavy = definition("heavy_strike", "Heavy Strike", [component("strike", "ATTACK", { action: attack({
    power: op("ADD", op("MULTIPLY", ref("actor.stats.physical_capability"), c(1.1)), op("MULTIPLY", ref("actor.stats.energy_output"), c(0.2))),
    accuracy: c(54), speed: c(48), cost: c(20)
  }) })], { aliases: { en: ["Heavy Strike", "power strike"], es: ["Heavy Strike", "golpe fuerte", "ataque potente"] }, cooldown: { key: "core.example.heavy_strike", duration: 1, unit: "TURN", starts: "ON_USE" } });

  const barrageAction = attack({ power: op("MULTIPLY", ref("actor.stats.energy_output"), c(0.45)), accuracy: c(68), speed: c(82), quantity: c(5), cost: c(5) });
  barrageAction.costs[0] = { resource: "energy", amount: 5, timing: "reserve", mode: "PER_HIT", upfront_amount: 0, per_hit_amount: 0 };
  const barrage = definition("rapid_barrage", "Rapid Barrage", [component("volley", "ATTACK", { action: barrageAction })]);

  const guard = definition("guard_field", "Guard Field", [component("guard", "TEMPORAL_EFFECT", {
    defense_source: { id: "guard-field.dynamic", definition: { available: true, automatic: false, base_filter: 35, compatibility: { normal: 0.8 }, penetration_compatibility: 0.7, geometry_overlap: 1, method_skill_bonus: 5, commitment_penalty: 0, stability_capacity: 100, anchor_capacity: 100, prepared: true, supported_methods: ["barrier"], maximum_hits: null, tags: ["field"] } },
    effects: [{ type: "ADD_MODIFIER", scope: "CHARACTER", target_ref: "$actor", modifier: { id: "guard-field.modifier", layer: "CHARACTER", target: "defense.execution", operation: "additive", value: 12, priority: 0, source_ref: "core.example.guard_field" }, duration: { type: "TURN", remaining: 2 } }]
  }, "ACTION"), component("block", "REACTION", { reaction: {
    id: "guard-field.block", reactor_id: "$actor", target_action_id: "$target_action", trigger: "ACTION_DECLARED", method: "barrier",
    timing: { latency_seconds: 0.1, priority: 0, chain_depth: 0 }, cost: { resource: "energy", amount: 6 }, action_economy_cost: 1,
    coverage: { scope: "ENTIRE_ACTION", maximum_hits: null, target_refs: ["$actor"] },
    defense: { source_ref: "guard-field.dynamic", declared_coverage: 1 }, effect: { kind: "DEFEND", magnitude: 1 }, tags: ["ability", "barrier"]
  } }, "REACTION")]);

  const dash = definition("dash_strike", "Dash Strike", [component("dash", "MOVEMENT", { action: movement() }, "MOVEMENT"), component("strike", "ATTACK", { action: attack({ power: c(62), accuracy: c(72), speed: c(78), cost: c(8) }) }, "ACTION")]);
  const disrupting = definition("disrupting_shot", "Disrupting Shot", [component("shot", "STATUS_ATTEMPT", { action: attack({ status: [{ status_id: "disrupted", potency: 45, duration_turns: 2 }] }) })]);
  const delayed = definition("delayed_burst", "Delayed Burst", [component("schedule", "TEMPORAL_EFFECT", { effects: [{ type: "SCHEDULE_EFFECT", scheduled_effect: { id: "delayed-burst", source_ref: "core.example.delayed_burst", target_ref: "$target.0", activation: { type: "TURN", turn: 1 }, effects: [{ type: "RESOURCE_DELTA", target_ref: "$target.0", resource: "stability", amount: -12 }], priority: 0, created_turn: 0, activated: false } }] }, "ACTION")]);
  const prepared = definition("prepared_counter", "Prepared Counter", [component("prepare", "TEMPORAL_EFFECT", { effects: [{ type: "CREATE_OPPORTUNITY", opportunity: { id: "prepared-counter", kind: "COUNTER_SETUP", source_ref: "core.example.prepared_counter", owner_ref: "$actor", target_ref: "$target.0", trigger: { event_occurred: { type: "action_declared", actor_ref: "$target.0" } }, effects: [], reaction_template: null, duration: { type: "TURN", remaining: 2 }, consumption: "ON_TRIGGER", created_turn: 0, trigger_count: 0, consumed: false, tags: ["counter"] } }] }, "ACTION")]);

  const areaAction = attack({ power: c(55), accuracy: c(64), speed: c(60), cost: c(18) });
  areaAction.attack.area = { shape: "sphere", dimensions: { radius: 5 }, falloff: "linear" };
  areaAction.attack.targeting = { mode: "EACH_TARGET", allocations: [] };
  const pulse = definition("area_pulse", "Area Pulse", [component("pulse", "AREA_EFFECT", { action: areaAction })]);
  const suppression = definition("resource_suppression", "Resource Suppression", [component("suppress", "RESOURCE_DENIAL", { action: { ...attack({ power: c(0), accuracy: c(70), cost: c(12) }), kind: "interaction", attack: null }, effects: [{ type: "RESOURCE_DELTA", target_ref: "$target.0", resource: "energy", amount: -10 }] })]);

  const tacticalDag = {
    strategy_id: "core.example.tactical_opening:dag", owner: "$actor", state: "ACTIVE", completion_policy: "ALL_TERMINAL", goals: { required: ["attack"], optional: [] }, metadata: { source: "ability" },
    nodes: [
      { id: "setup", kind: "STATE_TRANSITION", execution_class: "ZERO_TIME", state: "PENDING", dependency_mode: "ALL_OF", dependencies: [], conditions: [], failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "CONDITION_TRUE", action: null, primitive: null, condition: null, effects: { on_success: [], on_partial: [], on_failure: [], on_completion: [] } },
      { id: "branch", kind: "CONDITION", execution_class: "ZERO_TIME", state: "PENDING", dependency_mode: "ALL_OF", dependencies: [{ node_id: "setup", when: "ON_SUCCESS" }], conditions: [], failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "CONDITION_TRUE", action: null, primitive: null, condition: { compare: { left: "world.turn", operator: "gte", right: 0 } }, effects: { on_success: [], on_partial: [], on_failure: [], on_completion: [] } },
      { id: "attack", kind: "ACTION", execution_class: "ACTION", state: "PENDING", dependency_mode: "ALL_OF", dependencies: [{ node_id: "branch", when: "ON_SUCCESS" }], conditions: [], failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "RESOLVED", action: strategyAction(), primitive: null, condition: null, effects: { on_success: [], on_partial: [], on_failure: [], on_completion: [] } }
    ]
  };
  const tactical = definition("tactical_opening", "Tactical Opening", [component("plan", "STRATEGY_FRAGMENT", { strategy: tacticalDag })], { aliases: { en: ["Tactical Opening"], es: ["Tactical Opening", "apertura táctica", "apertura tactica"] } });

  const parameterized = definition("parameterized_blast", "Parameterized Blast", [component("blast", "ATTACK", { action: attack({
    power: op("ADD", c(40), op("MULTIPLY", ref("parameters.charge"), c(80))),
    cost: op("ADD", c(8), op("MULTIPLY", ref("parameters.charge"), c(22)))
  }) })], { parameters: { charge: { type: "number", minimum: 0, maximum: 1, default: 0 } } });

  const conditional = definition("conditional_follow_up", "Conditional Follow-up", [
    component("base", "ATTACK", { action: attack({ power: c(45), cost: c(5) }) }),
    component("follow_up", "ATTACK", { action: attack({ power: c(30), cost: c(4) }) }, "ACTION", { compare: { left: "parameters.mode", operator: "eq", right: "FOLLOW_UP" } })
  ], { parameters: { mode: { type: "enum", values: ["BASE", "FOLLOW_UP"], default: "BASE" } }, variants: { POWERFUL: { constant_overrides: {}, component_overrides: { base: { action: { attack: { power: c(70), accuracy: c(58) } } } } } } });

  return [heavy, barrage, guard, dash, disrupting, delayed, prepared, pulse, suppression, tactical, parameterized, conditional];
}
