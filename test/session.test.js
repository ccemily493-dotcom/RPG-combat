import test from "node:test";
import assert from "node:assert/strict";
import { canonicalHash, stableStringify } from "../src/index.js";
import { clone, loadSessionScenarioFixture } from "./helpers.js";

const { engine, scenarios } = await loadSessionScenarioFixture();

function stepInput(scenario, snapshot, step, suffix = "test") {
  return {
    id: `${scenario.id}:${suffix}`,
    snapshot,
    declarations: step.declarations,
    registries: scenario.registries,
    seed: step.seed,
    trace: true
  };
}

test("Scenario A persists a modifier for one later action and then expires it", () => {
  const result = engine.resolveSession(clone(scenarios.A));
  const benefited = result.stepResults[1].turnResult.actionResults[0].hits[0].trace.offense.resolved.accuracy.activeModifierIds;
  const expired = result.stepResults[2].turnResult.actionResults[0].hits[0].trace.offense.resolved.accuracy.activeModifierIds;
  assert.ok(benefited.includes("A.accuracy"));
  assert.ok(!expired.includes("A.accuracy"));
  assert.ok(result.stepResults[1].temporalEvents.some((event) => event.type === "temporal_state_expired" && event.state_id === "A.accuracy"));
});

test("Scenario B enforces cooldown availability without mutating a failed attempt", () => {
  const scenario = clone(scenarios.B);
  const first = engine.resolveSessionStep(stepInput(scenario, scenario.initial_snapshot, scenario.steps[0], "first"));
  const before = stableStringify(first.nextSnapshot);
  assert.throws(() => engine.resolveSessionStep(stepInput(scenario, first.nextSnapshot, scenario.steps[1], "blocked")), /cooldown/i);
  assert.equal(stableStringify(first.nextSnapshot), before);
  const progress = engine.resolveSessionStep(stepInput(scenario, first.nextSnapshot, scenario.steps[2], "progress"));
  const ready = engine.resolveSessionStep(stepInput(scenario, progress.nextSnapshot, scenario.steps[3], "ready"));
  assert.equal(ready.outcome, "committed");
  assert.equal(ready.turnResult.actionResults[0].outcome, "resolved");
});

test("Scenario C activates a delayed effect at its declared turn and not before", () => {
  const result = engine.resolveSession(clone(scenarios.C));
  assert.ok(result.stepResults[0].nextSnapshot.temporal_state.scheduled_effects.some((effect) => effect.id === "C.next-turn"));
  assert.ok(!result.stepResults[0].temporalEvents.some((event) => event.type === "scheduled_effect_activated"));
  assert.ok(result.stepResults[1].temporalEvents.some((event) => event.type === "scheduled_effect_activated" && event.scheduled_effect_id === "C.next-turn"));
  assert.ok(result.stepResults[1].turnResult.actionResults[0].hits[0].trace.offense.resolved.accuracy.activeModifierIds.includes("C.delayed-accuracy"));
});

test("Scenario D executes distraction, reposition, and ordinary attack payoff in one turn when economy permits", () => {
  const result = engine.resolveSession(clone(scenarios.D));
  const states = Object.fromEntries(result.finalSnapshot.strategies[0].nodes.map((node) => [node.id, node.state]));
  assert.deepEqual(states, { "D.attack": "SUCCEEDED", "D.distraction": "SUCCEEDED", "D.reposition": "SUCCEEDED" });
  assert.deepEqual(result.finalSnapshot.characters.a.transform.position, { x: 2, y: 2, z: 0 });
  const hit = result.stepResults[0].turnResult.actionResults.find((action) => action.id === "D.payoff").hits[0];
  assert.ok(hit.trace.offense.resolved.accuracy.activeModifierIds.includes("D.blind-spot:accuracy"));
  assert.ok(hit.trace.accuracy.targetScore.activeModifierIds.includes("D.attention"));
  assert.ok(result.stepResults[0].temporalEvents.some((event) => event.type === "relation_consumed"));
});

test("Scenario E applies the declared failure policy without hidden payoff", () => {
  const result = engine.resolveSession(clone(scenarios.E));
  const states = Object.fromEntries(result.finalSnapshot.strategies[0].nodes.map((node) => [node.id, node.state]));
  assert.deepEqual(states, { "E.attack": "CANCELLED", "E.distraction": "FAILED", "E.reposition": "CANCELLED" });
  assert.equal(result.stepResults.flatMap((step) => step.turnResult.actionResults).length, 0);
  assert.equal(result.finalSnapshot.temporal_state.relations.length, 0);
});

test("Scenario F selects deterministic success and failure branches", () => {
  const result = engine.resolveSession(clone(scenarios.F));
  const byStrategy = Object.fromEntries(result.finalSnapshot.strategies.map((strategy) => [strategy.strategy_id, Object.fromEntries(strategy.nodes.map((node) => [node.id, node.state]))]));
  assert.equal(byStrategy["F.pass"]["F.pass.success"], "SUCCEEDED");
  assert.equal(byStrategy["F.pass"]["F.pass.failure"], "BLOCKED");
  assert.equal(byStrategy["F.fail"]["F.fail.failure"], "SUCCEEDED");
  assert.equal(byStrategy["F.fail"]["F.fail.success"], "BLOCKED");
});

test("Scenarios G and I keep conditional state dormant until normalized triggers occur", () => {
  for (const [id, resource, delta] of [["G", "energy", 8], ["I", "stability", 9]]) {
    const scenario = clone(scenarios[id]);
    const result = engine.resolveSession(scenario);
    assert.ok(result.snapshots[1].temporal_state.opportunities.length === 1);
    assert.ok(result.snapshots[2].temporal_state.opportunities.length === 1);
    assert.equal(result.finalSnapshot.temporal_state.opportunities.length, 0);
    const before = scenario.initial_snapshot.characters.b.resources[resource].current;
    const after = result.finalSnapshot.characters.b.resources[resource].current;
    assert.ok(before - after >= delta);
  }
});

test("Scenario H triggers one prepared counter and consumes its reaction opportunity", () => {
  const result = engine.resolveSession(clone(scenarios.H));
  assert.equal(result.stepResults[1].turnResult.reactionResults.length, 1);
  assert.equal(result.stepResults[1].turnResult.reactionResults[0].outcome, "applied");
  assert.equal(result.finalSnapshot.temporal_state.opportunities.length, 0);
  assert.equal(result.finalSnapshot.characters.a.action_economy.reactions_remaining, 1);
});

test("Scenario J applies area denial through the existing modifier resolver", () => {
  const result = engine.resolveSession(clone(scenarios.J));
  const active = result.stepResults[1].turnResult.actionResults[0].hits[0].trace.offense.resolved.accuracy.activeModifierIds;
  assert.ok(active.includes("J.area"));
  assert.ok(result.stepResults[1].temporalEvents.some((event) => event.state_id === "J.area" && event.type === "temporal_state_expired"));
});

test("Scenario K expires every finite duration at its explicit lifecycle point", () => {
  const result = engine.resolveSession(clone(scenarios.K));
  assert.deepEqual(result.finalSnapshot.temporal_state.relations.map((relation) => relation.id), ["K.permanent"]);
  const expiredIds = result.stepResults[0].temporalEvents.filter((event) => event.type === "temporal_state_expired").map((event) => event.state_id).sort();
  assert.deepEqual(expiredIds, ["K.action", "K.condition", "K.phase", "K.reaction", "K.triggered", "K.turn"]);
});

test("Scenario L merges simultaneous strategic consequences in stable id order", () => {
  const forward = engine.resolveSession(clone(scenarios.L));
  const reversedInput = clone(scenarios.L);
  reversedInput.initial_snapshot.strategies.reverse();
  const reversed = engine.resolveSession(reversedInput);
  assert.equal(forward.resultHash, reversed.resultHash);
  assert.deepEqual(forward.finalSnapshot.characters.b.modifiers.map((modifier) => modifier.id), ["character.guard.execution", "L.alpha.mod", "L.beta.mod"]);
});

test("Scenario M rejects a cyclic graph before any commit", () => {
  const scenario = clone(scenarios.M);
  const before = canonicalHash(scenario.initial_snapshot);
  assert.throws(() => engine.resolveSession(scenario), /cycle/i);
  assert.equal(canonicalHash(scenario.initial_snapshot), before);
});

test("Scenario N replays five chained turns byte-for-byte with bounded history", () => {
  const replay = engine.replaySession(clone(scenarios.N));
  assert.equal(replay.deterministic, true);
  assert.equal(replay.result.stepResults.length, 5);
  assert.equal(replay.result.snapshots.length, 6);
  assert.equal(replay.result.finalSnapshot.temporal_state.mechanical_history.length, 5);
  assert.equal(new Set(replay.result.stepResults.map((step) => step.resultHash)).size, 5);
});

test("session trace suppression leaves mechanics unchanged", () => {
  const traced = engine.resolveSession({ ...clone(scenarios.D), trace: true });
  const untraced = engine.resolveSession({ ...clone(scenarios.D), trace: false });
  assert.equal(traced.resultHash, untraced.resultHash);
  assert.equal(untraced.trace, undefined);
  assert.ok(untraced.stepResults.every((step) => step.trace === undefined && step.turnResult.trace === undefined));
});

test("session orchestration never mutates initial or historical snapshots", () => {
  const input = clone(scenarios.N);
  const before = stableStringify(input);
  const result = engine.resolveSession(input);
  assert.equal(stableStringify(input), before);
  const firstHash = canonicalHash(result.snapshots[0]);
  assert.equal(firstHash, canonicalHash(input.initial_snapshot));
  assert.notEqual(result.snapshots[0], result.snapshots[1]);
});

test("strategy-emitted action is mechanically identical to the same direct action", () => {
  const strategic = clone(scenarios.D);
  const payoffNode = strategic.initial_snapshot.strategies[0].nodes.find((node) => node.id === "D.attack");
  payoffNode.dependencies = [];
  strategic.initial_snapshot.strategies[0].nodes = [payoffNode];
  strategic.steps = [strategic.steps[2]];
  strategic.steps[0].declarations = { actions: [], reactions: [] };
  strategic.steps[0].seed = "equivalence";
  const direct = clone(strategic);
  direct.initial_snapshot.strategies = [];
  const directAction = clone(payoffNode.action);
  directAction.turn = 0;
  direct.steps[0].declarations.actions = [directAction];
  const throughStrategy = engine.resolveSession(strategic);
  const directly = engine.resolveSession(direct);
  assert.equal(stableStringify(throughStrategy.stepResults[0].turnResult.actionResults), stableStringify(directly.stepResults[0].turnResult.actionResults));
});

test("explicit recovery hooks clamp resources and capacities to configured bounds", () => {
  const scenario = clone(scenarios.N);
  scenario.steps = [scenario.steps[0]];
  scenario.initial_snapshot.characters.a.resources.energy.current = 999;
  scenario.initial_snapshot.characters.a.action_economy.reactions_remaining = 0;
  scenario.initial_snapshot.temporal_state.recovery_hooks = [
    { id: "recover.energy", kind: "RESOURCE", character_ref: "a", resource: "energy", amount: 100, phase: "TURN_START", enabled: true },
    { id: "recover.reaction", kind: "REACTION_CAPACITY", character_ref: "a", resource: null, amount: 100, phase: "TURN_START", enabled: true }
  ];
  const result = engine.resolveSession(scenario);
  assert.equal(result.finalSnapshot.characters.a.resources.energy.current, result.finalSnapshot.characters.a.resources.energy.maximum);
  assert.equal(result.finalSnapshot.characters.a.action_economy.reactions_remaining, result.finalSnapshot.characters.a.action_economy.reaction_capacity);
});
