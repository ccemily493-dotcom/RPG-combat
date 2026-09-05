import test from "node:test";
import assert from "node:assert/strict";
import { beginStrategyStep, completeStrategyStep, scheduleStrategyNodes } from "../src/index.js";
import { clone, loadSessionScenarioFixture } from "./helpers.js";

const { engine, scenarios } = await loadSessionScenarioFixture();

function emptyEffects() {
  return { on_success: [], on_partial: [], on_failure: [], on_completion: [] };
}

function conditionNode(id, dependencies = []) {
  return {
    id,
    kind: "CONDITION",
    execution_class: "ZERO_TIME",
    state: "PENDING",
    dependency_mode: "ALL_OF",
    dependencies,
    conditions: [],
    condition: { compare: { left: "world.turn", operator: "gte", right: 0 } },
    failure_policy: "CONTINUE",
    fallback_node_ids: [],
    completion_rule: "CONDITION_TRUE",
    action: null,
    primitive: null,
    effects: emptyEffects()
  };
}

function actionNode(id, action, dependencies = [], executionClass = "ACTION") {
  return {
    id,
    kind: "ACTION",
    execution_class: executionClass,
    state: "PENDING",
    dependency_mode: "ALL_OF",
    dependencies,
    conditions: [],
    condition: null,
    failure_policy: "CONTINUE",
    fallback_node_ids: [],
    completion_rule: "RESOLVED",
    action: { ...clone(action), id },
    primitive: null,
    effects: emptyEffects()
  };
}

function sessionWith(nodes, actionCapacity = 4) {
  const input = clone(scenarios.D);
  input.id = `v031:${nodes.map((node) => node.id).join(":")}:${actionCapacity}`;
  input.initial_snapshot.strategies = [{
    strategy_id: `${input.id}:dag`,
    owner: "a",
    state: "ACTIVE",
    completion_policy: "ALL_TERMINAL",
    goals: { required: [nodes.at(-1).id], optional: [] },
    nodes,
    metadata: {}
  }];
  input.initial_snapshot.characters.a.action_economy.action_capacity = actionCapacity;
  input.initial_snapshot.characters.a.action_economy.actions_remaining = actionCapacity;
  input.steps = [input.steps[0], input.steps[0], input.steps[0]];
  return input;
}

test("v0.3.1 Scenario A chains ZERO_TIME condition and branch into ACTION in one step", () => {
  const template = scenarios.D.initial_snapshot.strategies[0].nodes.find((node) => node.id === "D.attack").action;
  const nodes = [
    conditionNode("A.condition"),
    conditionNode("A.branch", [{ node_id: "A.condition", when: "ON_SUCCESS" }]),
    actionNode("A.action", template, [{ node_id: "A.branch", when: "ON_SUCCESS" }])
  ];
  const result = engine.resolveSession(sessionWith(nodes));
  assert.deepEqual(result.stepResults[0].strategyProgress.results.map((item) => item.nodeId), ["A.condition", "A.branch", "A.action"]);
  assert.equal(result.snapshots[1].strategies[0].state, "COMPLETED");
});

test("v0.3.1 Scenarios B/C chain two ACTION nodes in one turn or span turns solely by economy", () => {
  const template = scenarios.D.initial_snapshot.strategies[0].nodes.find((node) => node.id === "D.attack").action;
  const makeNodes = () => [
    actionNode("B.first", template),
    conditionNode("B.transition", [{ node_id: "B.first", when: "ON_SUCCESS" }]),
    actionNode("B.second", template, [{ node_id: "B.transition", when: "ON_SUCCESS" }])
  ];
  const high = engine.resolveSession(sessionWith(makeNodes(), 2));
  assert.deepEqual(high.stepResults[0].turnResult.actionResults.map((item) => item.id), ["B.first", "B.second"]);
  const low = engine.resolveSession(sessionWith(makeNodes(), 1));
  assert.deepEqual(low.stepResults[0].turnResult.actionResults.map((item) => item.id), ["B.first"]);
  assert.deepEqual(low.stepResults[1].turnResult.actionResults.map((item) => item.id), ["B.second"]);
});

test("v0.3.1 execution classes consume only their declared economy", () => {
  const template = scenarios.D.initial_snapshot.strategies[0].nodes.find((node) => node.id === "D.attack").action;
  for (const [executionClass, setup, remainingPath] of [
    ["ACTION", (character) => { character.action_economy.action_capacity = 1; character.action_economy.actions_remaining = 1; }, ["action_economy", "actions_remaining"]],
    ["REACTION", (character) => { character.action_economy.reaction_capacity = 1; character.action_economy.reactions_remaining = 1; }, ["action_economy", "reactions_remaining"]],
    ["MOVEMENT", (character) => { character.movement_capacity = 1; character.movement_economy = 1; }, ["movement_economy"]]
  ]) {
    const input = sessionWith([actionNode(`economy.${executionClass}`, template, [], executionClass)]);
    setup(input.initial_snapshot.characters.a);
    input.steps = [input.steps[0]];
    const result = engine.resolveSession(input);
    const character = result.finalSnapshot.characters.a;
    const remaining = remainingPath.length === 1 ? character[remainingPath[0]] : character[remainingPath[0]][remainingPath[1]];
    assert.equal(remaining, 0, `${executionClass} did not consume its economy`);
  }
});

test("v0.3.1 unavailable ACTION, REACTION, and MOVEMENT nodes remain pending", () => {
  const template = scenarios.D.initial_snapshot.strategies[0].nodes.find((node) => node.id === "D.attack").action;
  for (const executionClass of ["ACTION", "REACTION", "MOVEMENT"]) {
    const input = sessionWith([actionNode(`blocked.${executionClass}`, template, [], executionClass)], 0);
    const character = input.initial_snapshot.characters.a;
    character.action_economy.action_capacity = 0;
    character.action_economy.actions_remaining = 0;
    character.action_economy.reaction_capacity = 0;
    character.action_economy.reactions_remaining = 0;
    if (executionClass === "MOVEMENT") { character.movement_capacity = 0; character.movement_economy = 0; }
    input.steps = [input.steps[0]];
    const result = engine.resolveSession(input);
    assert.equal(result.finalSnapshot.strategies[0].nodes[0].state, "PENDING");
    assert.equal(result.stepResults[0].turnResult.actionResults.length, 0);
  }
});

test("v0.3.1 PARTIAL dependencies remain explicit", () => {
  const base = clone(scenarios.N.initial_snapshot);
  const predecessor = conditionNode("partial.source");
  predecessor.state = "SUCCEEDED";
  predecessor.result_band = "PARTIAL";
  const partial = conditionNode("partial.accept", [{ node_id: "partial.source", when: "ON_PARTIAL_OR_BETTER" }]);
  const strict = conditionNode("partial.strict", [{ node_id: "partial.source", when: "ON_SUCCESS" }]);
  const strategy = { strategy_id: "partial.dag", owner: "a", state: "ACTIVE", completion_policy: "ALL_TERMINAL", goals: { required: [], optional: [] }, nodes: [predecessor, partial, strict], metadata: {} };
  const scheduled = scheduleStrategyNodes([strategy], { ...base, declarations: { actions: [], reactions: [] }, seed: "partial" });
  assert.equal(scheduled.records.find((item) => item.nodeId === "partial.accept").eligible, true);
  assert.equal(scheduled.records.find((item) => item.nodeId === "partial.strict").eligible, false);
});

test("v0.3.1 structural completion preserves failed required goal", () => {
  const failed = conditionNode("goal.failed");
  failed.state = "FAILED";
  const strategy = { strategy_id: "goal.dag", owner: "a", state: "ACTIVE", completion_policy: "REQUIRED_GOALS", goals: { required: [failed.id], optional: [] }, nodes: [failed], metadata: {} };
  const progress = completeStrategyStep([strategy], { immediateResults: [], actionBindings: [] }, []);
  assert.equal(strategy.state, "COMPLETED");
  assert.equal(progress.strategies[0].goals.required[0].state, "FAILED");
});

test("v0.3.1 zero-time safety failure is deterministic and leaves caller state unchanged", () => {
  const limit = engine.config.specs["strategy.yaml"].dag_execution.strategy_scheduler.max_zero_time_transitions_per_step.value;
  const nodes = Array.from({ length: limit + 1 }, (_, index) => conditionNode(`limit.${index}`, index ? [{ node_id: `limit.${index - 1}`, when: "ON_SUCCESS" }] : []));
  const input = sessionWith(nodes);
  const before = JSON.stringify(input.initial_snapshot);
  assert.throws(() => engine.resolveSession(input), /zero-time transition limit/i);
  assert.equal(JSON.stringify(input.initial_snapshot), before);
});
