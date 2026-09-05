import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { applyTemporalEffect, canonicalHash, stableStringify } from "../src/index.js";
import {
  AbilityCompilationCache,
  AbilityParserError,
  compileAbilityDefinition,
  compileAbilityRegistry,
  evaluateExpression,
  inspectAbility,
  instantiateAbilityUse,
  validateAbilityDefinition,
  validateExpression
} from "../src/ability-parser/index.js";
import { buildGenericAbilityDefinitions } from "../src/ability-parser/fixtures.js";
import { clone, loadScenarioFixture, loadSessionScenarioFixture } from "./helpers.js";

const { engine, scenarios } = await loadScenarioFixture();
const { scenarios: sessions } = await loadSessionScenarioFixture();
const definitions = buildGenericAbilityDefinitions();
const context = {
  rulesetVersion: engine.config.version,
  stats: Object.keys(engine.config.specs["stats.yaml"].stats),
  resources: Object.keys(scenarios.A.characters.a.resources),
  registries: scenarios.A.registries
};
const registry = compileAbilityRegistry(definitions, context);

function use(id, actor = "a", targets = ["b"], options = {}, parameters = {}) {
  return {
    ability_id: id,
    actor_id: actor,
    targets: targets.map((ref) => ({ type: "character", ref, position: null, body_zone: "core" })),
    parameters,
    declared_options: { turn: 0, ...options }
  };
}

function instantiate(id, scenario = scenarios.A, options = {}, parameters = {}, targets = ["b"], actor = "a") {
  return instantiateAbilityUse(registry.get(id), use(id, actor, targets, options, parameters), { characters: scenario.characters, world: scenario.world });
}

test("v0.4 compiles twelve generic ability fixtures deterministically", () => {
  assert.equal(registry.size, 12);
  assert.deepEqual(registry.ids, [...registry.ids].sort());
  for (const ability of registry.values()) {
    assert.equal(ability.mechanical_hash.length, 64);
    assert.equal(compileAbilityDefinition(definitions.find((item) => item.ability_id === ability.ability_id), context).mechanical_hash, ability.mechanical_hash);
  }
});

test("Scenario A: Heavy Strike compiles, instantiates, and resolves only through RPG Engine", () => {
  const payload = instantiate("core.example.heavy_strike");
  assert.equal(payload.actions.length, 1);
  assert.equal(payload.actions[0].attack.power, 90.8);
  assert.equal(Object.hasOwn(payload.actions[0], "final_damage"), false);
  const result = engine.resolveTurn({ ...clone(scenarios.A), id: "ability-heavy", actions: payload.actions, reactions: [], seed: "ability-heavy" });
  assert.equal(result.actionResults[0].outcome, "resolved");
  assert.ok(result.actionResults[0].healthDamage > 0);
});

test("Scenario B: Rapid Barrage delegates five hits and PER_HIT cost to combat loop", () => {
  const payload = instantiate("core.example.rapid_barrage");
  assert.equal(payload.actions[0].attack.quantity, 5);
  assert.equal(payload.actions[0].costs[0].mode, "PER_HIT");
  const result = engine.resolveTurn({ ...clone(scenarios.A), id: "ability-barrage", actions: payload.actions, reactions: [], seed: "ability-barrage" });
  assert.equal(result.actionResults[0].declaredQuantity, 5);
  assert.equal(result.actionResults[0].hits.length, 5);
  assert.equal(result.characters.a.resources.energy.current, scenarios.A.characters.a.resources.energy.current - 25);
});

test("Scenario C: Guard Field emits a defense source and reaction; engine determines filtering", () => {
  const incoming = clone(instantiate("core.example.heavy_strike").actions[0]);
  incoming.id = "guard.incoming";
  const guard = instantiate("core.example.guard_field", scenarios.A, { target_action_id: incoming.id }, {}, ["a"], "b");
  assert.equal(guard.defense_sources.length, 1);
  assert.equal(guard.reactions.length, 1);
  const scenario = clone(scenarios.A);
  scenario.registries.defense_sources[guard.defense_sources[0].id] = guard.defense_sources[0].definition;
  const result = engine.resolveTurn({ ...scenario, id: "ability-guard", actions: [incoming], reactions: guard.reactions, seed: "ability-guard" });
  assert.equal(result.reactionResults[0].outcome, "applied");
  assert.ok(result.actionResults[0].hits[0].defenseFilter > 0);
});

test("Scenario D: Dash Strike emits movement plus attack with ordinary economy", () => {
  const scenario = clone(scenarios.A);
  scenario.characters.a.action_economy.action_capacity = 2;
  scenario.characters.a.action_economy.actions_remaining = 2;
  const payload = instantiate("core.example.dash_strike", scenario);
  assert.deepEqual(payload.actions.map((action) => action.kind).sort(), ["attack", "movement"]);
  const result = engine.resolveTurn({ ...scenario, id: "ability-dash", actions: payload.actions, reactions: [], seed: "ability-dash" });
  assert.equal(result.actionResults.length, 2);
  assert.equal(result.characters.a.action_economy.actions_remaining, 0);
});

test("Scenario E: Disrupting Shot emits a status attempt, never application authority", () => {
  const payload = instantiate("core.example.disrupting_shot");
  const attempt = payload.actions[0].attack.status_effects[0];
  assert.equal(attempt.status_id, "disrupted");
  assert.equal(Object.hasOwn(attempt, "applied"), false);
  const result = engine.resolveTurn({ ...clone(scenarios.A), id: "ability-disrupt", actions: payload.actions, reactions: [], seed: "ability-disrupt" });
  assert.ok(Array.isArray(result.actionResults[0].hits[0].statuses));
});

test("Scenario F: Delayed Burst uses the temporal engine and cannot activate early", () => {
  const payload = instantiate("core.example.delayed_burst");
  const scenario = clone(sessions.N);
  scenario.initial_snapshot.strategies = [];
  applyTemporalEffect(scenario.initial_snapshot, payload.temporal_effects[0], { declarations: { actions: [], reactions: [] }, events: [], creation_turn: 0 }, "ability:delayed");
  const before = scenario.initial_snapshot.characters.b.resources.stability.current;
  const first = engine.resolveSessionStep({ id: "ability-delay:0", snapshot: scenario.initial_snapshot, declarations: { actions: [], reactions: [] }, registries: scenario.registries, seed: "delay:0", trace: true });
  assert.equal(first.nextSnapshot.characters.b.resources.stability.current, before);
  const second = engine.resolveSessionStep({ id: "ability-delay:1", snapshot: first.nextSnapshot, declarations: { actions: [], reactions: [] }, registries: scenario.registries, seed: "delay:1", trace: true });
  assert.equal(second.nextSnapshot.characters.b.resources.stability.current, before - 12);
});

test("Scenarios G-I: opportunities, areas, and resource denial stay normalized and resource-agnostic", () => {
  const prepared = instantiate("core.example.prepared_counter");
  assert.equal(prepared.temporal_effects[0].type, "CREATE_OPPORTUNITY");
  const area = instantiate("core.example.area_pulse", scenarios.D, {}, {}, ["b", "c"]);
  assert.equal(area.actions[0].attack.targeting.mode, "EACH_TARGET");
  assert.equal(area.actions[0].targets.length, 2);
  const areaResult = engine.resolveTurn({ ...clone(scenarios.D), id: "ability-area", actions: area.actions, reactions: [], seed: "ability-area" });
  assert.deepEqual(areaResult.actionResults[0].targetAllocation.map((item) => item.targetId), ["b", "c"]);
  const denial = instantiate("core.example.resource_suppression");
  assert.equal(denial.temporal_effects[0].resource, "energy");
  assert.equal(denial.temporal_effects[0].amount, -10);
});

test("Scenario J: Tactical Opening emits a valid v0.3.1 DAG and pays ordinary economy", () => {
  const payload = instantiate("core.example.tactical_opening");
  const scenario = clone(sessions.N);
  scenario.initial_snapshot.strategies = payload.strategy_fragments;
  scenario.initial_snapshot.characters.a.action_economy.action_capacity = 1;
  scenario.initial_snapshot.characters.a.action_economy.actions_remaining = 1;
  const result = engine.resolveSessionStep({ id: "ability-strategy", snapshot: scenario.initial_snapshot, declarations: { actions: [], reactions: [] }, registries: scenario.registries, seed: "ability-strategy", trace: true });
  assert.equal(result.nextSnapshot.strategies[0].state, "COMPLETED");
  assert.equal(result.turnResult.actionResults.length, 1);
  assert.equal(result.nextSnapshot.characters.a.action_economy.actions_remaining, 0);
});

test("Scenarios K/L: parameters, variants, and declarative conditionals are deterministic", () => {
  const low = instantiate("core.example.parameterized_blast", scenarios.A, {}, { charge: 0 });
  const high = instantiate("core.example.parameterized_blast", scenarios.A, {}, { charge: 1 });
  assert.equal(low.actions[0].attack.power, 40);
  assert.equal(high.actions[0].attack.power, 120);
  assert.equal(high.actions[0].costs[0].amount, 30);
  assert.equal(instantiate("core.example.conditional_follow_up", scenarios.A, {}, { mode: "BASE" }).actions.length, 1);
  assert.equal(instantiate("core.example.conditional_follow_up", scenarios.A, {}, { mode: "FOLLOW_UP" }).actions.length, 2);
  assert.equal(instantiate("core.example.conditional_follow_up", scenarios.A, { variant: "POWERFUL" }, { mode: "BASE" }).actions[0].attack.power, 70);
});

test("same compiled ability and bindings produce byte-equivalent normalized payload", () => {
  const first = instantiate("core.example.parameterized_blast", scenarios.A, {}, { charge: 0.5 });
  const second = instantiate("core.example.parameterized_blast", scenarios.A, {}, { charge: 0.5 });
  assert.equal(stableStringify(first), stableStringify(second));
});

test("presentation-only edits preserve mechanical hash but change provenance hash", () => {
  const original = clone(definitions[0]);
  const edited = clone(original);
  edited.name = "Presentation Only";
  edited.description = "No mechanical meaning.";
  edited.flavor = "Also presentation only.";
  const left = compileAbilityDefinition(original, context);
  const right = compileAbilityDefinition(edited, context);
  assert.equal(left.mechanical_hash, right.mechanical_hash);
  assert.notEqual(left.definition_hash, right.definition_hash);
});

test("invalid schema, stat, resource, status, and expressions fail with structured errors", () => {
  assert.throws(() => validateAbilityDefinition(null), (error) => error instanceof AbilityParserError && error.code === "SCHEMA_ERROR");
  for (const [mutate, code] of [
    [(value) => { value.requirements = [{ type: "MIN_STAT", ref: "unknown_stat" }]; }, "REFERENCE_ERROR"],
    [(value) => { value.mechanics.components[0].output.action.costs[0].resource = "unknown_resource"; }, "REFERENCE_ERROR"],
    [(value) => { value.mechanics.components[0].output.action.attack.status_effects = [{ status_id: "unknown_status", potency: 1, duration_turns: 1 }]; }, "REFERENCE_ERROR"],
    [(value) => { value.mechanics.components[0].output.action.attack.power = { op: "EXECUTE", args: [{ const: 1 }] }; }, "EXPRESSION_ERROR"]
  ]) {
    const invalid = clone(definitions[0]);
    mutate(invalid);
    assert.throws(() => compileAbilityDefinition(invalid, context), (error) => error instanceof AbilityParserError && error.code === code);
  }
  const invalidDefense = clone(definitions.find((definition) => definition.ability_id === "core.example.guard_field"));
  invalidDefense.mechanics.components.find((component) => component.output.reaction).output.reaction.source_ref = "unknown_defense";
  assert.throws(() => compileAbilityDefinition(invalidDefense, context), (error) => error instanceof AbilityParserError && error.code === "REFERENCE_ERROR");
  assert.throws(() => evaluateExpression({ op: "DIVIDE", args: [{ const: 1 }, { const: 0 }] }, {}), (error) => error.code === "EXPRESSION_ERROR");
  const compiled = registry.get("core.example.parameterized_blast");
  assert.throws(() => instantiateAbilityUse(compiled, use(compiled.ability_id, "a", ["b"], {}, { charge: 2 }), { characters: scenarios.A.characters, world: scenarios.A.world }), /bounds/i);
  assert.throws(() => instantiateAbilityUse(compiled, use(compiled.ability_id, "a", ["missing"], {}, { charge: 0.5 }), { characters: scenarios.A.characters, world: scenarios.A.world }), (error) => error.code === "REFERENCE_ERROR");
});

test("division by zero, depth, and node limits fail without NaN or Infinity", () => {
  const invalid = clone(definitions[0]);
  invalid.mechanics.components[0].output.action.attack.power = { op: "DIVIDE", args: [{ const: 1 }, { ref: "parameters.zero" }] };
  invalid.parameters.zero = { type: "number", default: 0 };
  const compiled = compileAbilityDefinition(invalid, context);
  assert.throws(() => instantiateAbilityUse(compiled, use(compiled.ability_id, "a", ["b"], {}, { zero: 0 }), { characters: scenarios.A.characters, world: scenarios.A.world }), (error) => error.code === "EXPRESSION_ERROR");
  let deep = { const: 1 };
  for (let index = 0; index < 17; index += 1) deep = { op: "ABS", args: [deep] };
  assert.throws(() => validateExpression(deep, { maxDepth: 16 }), /depth/i);
  assert.throws(() => validateExpression({ op: "ADD", args: Array.from({ length: 129 }, () => ({ const: 1 })) }, { maxNodes: 128 }), /nodes/i);
});

test("cache and uncached compilation are canonical equivalents", () => {
  const cache = new AbilityCompilationCache();
  const uncached = compileAbilityDefinition(definitions[0], context);
  const first = cache.compile(definitions[0], context);
  const second = cache.compile(definitions[0], context);
  assert.equal(stableStringify(uncached), stableStringify(first));
  assert.equal(first, second);
  assert.deepEqual(cache.stats(), { size: 1, hits: 1, misses: 1 });
});

test("manual and generated identical normalized actions resolve identically", () => {
  const generated = instantiate("core.example.heavy_strike").actions[0];
  const manual = clone(generated);
  const base = clone(scenarios.A);
  const a = engine.resolveTurn({ ...base, id: "equivalence", actions: [manual], reactions: [], seed: "equivalence" });
  const b = engine.resolveTurn({ ...clone(scenarios.A), id: "equivalence", actions: [generated], reactions: [], seed: "equivalence" });
  assert.equal(a.resultHash, b.resultHash);
});

test("core source imports zero Ability Parser modules and parser imports no outcome resolver", async () => {
  const files = ["combat.js", "turn.js", "session.js", "strategy.js", "temporal.js", "index.js"];
  for (const file of files) {
    const source = await readFile(join(engine.config.specDir, "src", file), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*ability-parser/i);
  }
  const parserDir = join(engine.config.specDir, "src", "ability-parser");
  for (const file of (await readdir(parserDir)).filter((name) => name.endsWith(".js"))) {
    const parserSource = await readFile(join(parserDir, file), "utf8");
    assert.doesNotMatch(parserSource, /resolve(?:Turn|Encounter|Session)\s*\(/, file);
    assert.doesNotMatch(parserSource, /eval\s*\(|new\s+Function/, file);
  }
});

test("inspectAbility exposes complexity diagnostics without a balance score", () => {
  const inspected = inspectAbility(registry.get("core.example.tactical_opening"));
  assert.equal(inspected.strategy_fragment_count, 1);
  assert.equal(Object.hasOwn(inspected, "balance_score"), false);
  assert.equal(Object.hasOwn(inspected, "strategyScore"), false);
});
