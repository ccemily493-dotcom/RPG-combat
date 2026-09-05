import test from "node:test";
import assert from "node:assert/strict";
import { canonicalHash } from "../src/index.js";
import { clone, loadSessionScenarioFixture } from "./helpers.js";

const { engine, scenarios } = await loadSessionScenarioFixture();

function stepInput(scenario, snapshot, step, extra = {}) {
  return { id: `${scenario.id}:property`, snapshot, declarations: step.declarations, registries: scenario.registries, seed: step.seed, trace: true, ...extra };
}

test("property: invalid dependencies and strategy action targets fail before commit", () => {
  const badDependency = clone(scenarios.N);
  badDependency.initial_snapshot.strategies[0].nodes[1].dependencies[0].node_id = "missing";
  const dependencyHash = canonicalHash(badDependency.initial_snapshot);
  assert.throws(() => engine.resolveSession(badDependency), /unknown node/i);
  assert.equal(canonicalHash(badDependency.initial_snapshot), dependencyHash);

  const badTarget = clone(scenarios.D);
  badTarget.initial_snapshot.strategies[0].nodes.find((node) => node.id === "D.attack").action.targets[0].ref = "missing";
  const targetHash = canonicalHash(badTarget.initial_snapshot);
  assert.throws(() => engine.resolveSession(badTarget), /unknown target/i);
  assert.equal(canonicalHash(badTarget.initial_snapshot), targetHash);
});

test("property: unavailable strategy resources leave action nodes pending", () => {
  const scenario = clone(scenarios.D);
  const actionNode = scenario.initial_snapshot.strategies[0].nodes.find((node) => node.id === "D.attack");
  actionNode.dependencies = [];
  actionNode.action.costs[0].amount = 2000;
  scenario.initial_snapshot.strategies[0].nodes = [actionNode];
  const result = engine.resolveSessionStep(stepInput(scenario, scenario.initial_snapshot, scenario.steps[0]));
  assert.equal(result.turnResult.actionResults.length, 0);
  assert.equal(result.nextSnapshot.strategies[0].nodes[0].state, "PENDING");
  assert.equal(result.strategyProgress.eligibility[0].reason, "resource_unavailable:energy");
});

test("property: ON_SUCCESS opportunity survives an unsuccessful generated reaction", () => {
  const scenario = clone(scenarios.H);
  const prepared = engine.resolveSessionStep(stepInput(scenario, scenario.initial_snapshot, scenario.steps[0]));
  const noEnergy = clone(prepared.nextSnapshot);
  noEnergy.characters.a.resources.energy.current = 0;
  const triggered = engine.resolveSessionStep(stepInput(scenario, noEnergy, scenario.steps[1]));
  assert.equal(triggered.turnResult.reactionResults[0].outcome, "unavailable");
  assert.equal(triggered.nextSnapshot.temporal_state.opportunities[0].id, "H.opportunity");
  assert.equal(triggered.nextSnapshot.temporal_state.opportunities[0].consumed, false);
});

test("property: prepared opportunities observe actions emitted by Strategy DAG nodes", () => {
  const counterScenario = clone(scenarios.H);
  const prepared = engine.resolveSessionStep(stepInput(counterScenario, counterScenario.initial_snapshot, counterScenario.steps[0]));
  const snapshot = clone(prepared.nextSnapshot);
  const incomingAction = clone(counterScenario.steps[1].declarations.actions[0]);
  const actionNode = clone(scenarios.D.initial_snapshot.strategies[0].nodes.find((node) => node.id === "D.attack"));
  actionNode.id = "strategy-incoming.node";
  actionNode.dependencies = [];
  actionNode.action = incomingAction;
  snapshot.strategies.push({ strategy_id: "strategy-incoming", owner: "b", state: "ACTIVE", nodes: [actionNode], metadata: { property: true } });
  const step = { declarations: { actions: [], reactions: [] }, seed: "strategy-trigger" };
  const result = engine.resolveSessionStep(stepInput(counterScenario, snapshot, step));
  assert.equal(result.turnResult.actionResults[0].id, incomingAction.id);
  assert.equal(result.turnResult.reactionResults[0].id, "H.prepared-block");
  assert.equal(result.turnResult.reactionResults[0].outcome, "applied");
});

test("property: ACTION duration progresses by normalized action-event count", () => {
  const scenario = clone(scenarios.K);
  scenario.initial_snapshot.temporal_state.relations = scenario.initial_snapshot.temporal_state.relations
    .filter((relation) => relation.id === "K.action");
  scenario.initial_snapshot.temporal_state.relations[0].duration.remaining = 3;
  const second = clone(scenario.steps[0].declarations.actions[0]);
  second.id = "K.attack-second";
  scenario.steps[0].declarations.actions.push(second);
  scenario.steps[0].declarations.reactions = [];
  const result = engine.resolveSession(scenario);
  assert.equal(result.finalSnapshot.temporal_state.relations[0].duration.remaining, 1);
});

test("property: invalid duration shapes fail formal schema validation", () => {
  const temporal = clone(scenarios.N.initial_snapshot.temporal_state);
  temporal.relations = [{
    id: "invalid-duration", kind: "CUSTOM_CORE", subject_ref: "a", object_ref: "b", source_ref: "test",
    duration: { type: "TURN", remaining: -1 }, consumption: "NEVER", modifiers: [], created_turn: 0, consumed: false, tags: []
  }];
  assert.throws(() => engine.schemas.validate("temporalState", temporal));
  temporal.relations[0].duration = { type: "PHASE", remaining: 1 };
  assert.throws(() => engine.schemas.validate("temporalState", temporal));
});

test("property: configured termination and paused sessions are deterministic", () => {
  const scenario = clone(scenarios.N);
  scenario.steps = [scenario.steps[0]];
  scenario.termination_predicates = [{ compare: { left: "world.turn", operator: "gte", right: 1 } }];
  const completed = engine.resolveSession(scenario);
  assert.equal(completed.finalSnapshot.temporal_state.session.status, "COMPLETED");
  assert.ok(completed.finalSnapshot.temporal_state.mechanical_history[0].events.some((event) => event.type === "session_completed"));

  const pausedInput = clone(scenarios.N);
  pausedInput.initial_snapshot.temporal_state.session.status = "PAUSED";
  pausedInput.steps = [pausedInput.steps[0]];
  assert.equal(Object.isFrozen(pausedInput.initial_snapshot), false);
  const paused = engine.resolveSession(pausedInput);
  assert.equal(paused.stepResults[0].outcome, "inactive");
  assert.equal(canonicalHash(paused.finalSnapshot), canonicalHash(pausedInput.initial_snapshot));
  assert.equal(Object.isFrozen(pausedInput.initial_snapshot), false);
});
