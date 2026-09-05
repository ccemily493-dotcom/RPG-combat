import test from "node:test";
import assert from "node:assert/strict";
import { compareBatchEquivalence, mergeStatuses, stableStringify } from "../src/index.js";
import { clone, loadScenarioFixture } from "./helpers.js";

const { engine, scenarios } = await loadScenarioFixture();

test("Scenario A preserves a one-attacker, one-defender, one-hit path", () => {
  const result = engine.resolveTurn(clone(scenarios.A));
  assert.equal(result.outcome, "committed");
  assert.equal(result.actionResults[0].representedHitCount, 1);
  assert.equal(result.actionResults[0].resolutionMode, "individual");
  assert.ok(result.actionResults[0].healthDamage > 0);
});

test("Scenario B resolves five hits independently with upfront-plus-per-hit cost", () => {
  const result = engine.resolveTurn(clone(scenarios.B));
  assert.equal(result.actionResults[0].hits.length, 5);
  assert.equal(result.actionResults[0].representedHitCount, 5);
  assert.equal(result.actionResults[0].costs[0].committedAmount, 7);
  assert.equal(result.characters.a.resources.energy.current, scenarios.B.characters.a.resources.energy.current - 7);
});

test("Scenario C resolves 500 declared attacks in deterministic batches", () => {
  const result = engine.resolveTurn(clone(scenarios.C));
  assert.equal(result.actionResults[0].resolutionMode, "batch");
  assert.equal(result.actionResults[0].representedHitCount, 500);
  assert.ok(result.actionResults[0].hits.length < 500);
  assert.equal(result.characters.a.resources.energy.current, scenarios.C.characters.a.resources.energy.current - 20);
});

test("Scenario D conserves explicit multi-target allocation", () => {
  const result = engine.resolveTurn(clone(scenarios.D));
  assert.deepEqual(result.actionResults[0].targetAllocation, [
    { targetId: "b", count: 1 }, { targetId: "c", count: 2 }, { targetId: "d", count: 3 }
  ]);
  assert.equal(result.actionResults[0].representedHitCount, 6);
  for (const id of ["b", "c", "d"]) assert.ok(result.characters[id].resources.health.current < scenarios.D.characters[id].resources.health.current);
});

test("Scenario E resolves both simultaneous attacks from the starting snapshot", () => {
  const result = engine.resolveTurn(clone(scenarios.E));
  assert.equal(result.actionResults.filter((action) => action.outcome === "resolved").length, 2);
  assert.ok(result.characters.a.resources.health.current < scenarios.E.characters.a.resources.health.current);
  assert.ok(result.characters.b.resources.health.current < scenarios.E.characters.b.resources.health.current);
});

test("Scenarios F and G apply defense coverage and enforce reaction capacity", () => {
  const single = engine.resolveTurn(clone(scenarios.F));
  assert.equal(single.reactionResults[0].outcome, "applied");
  assert.ok(single.actionResults[0].hits[0].defenseFilter > 0);
  const limited = engine.resolveTurn(clone(scenarios.G));
  assert.equal(limited.reactionResults.filter((reaction) => reaction.outcome === "applied").length, 2);
  assert.equal(limited.reactionResults.filter((reaction) => reaction.reason === "reaction_capacity_exhausted").length, 1);
  assert.equal(limited.characters.b.action_economy.reactions_remaining, 0);
});

test("Scenario H uses an explicit successful interrupt to cancel an action", () => {
  const result = engine.resolveTurn(clone(scenarios.H));
  assert.equal(result.reactionResults[0].interruption.success, true);
  assert.equal(result.actionResults[0].outcome, "cancelled");
  assert.equal(result.actionResults[0].representedHitCount, 0);
  assert.equal(result.characters.a.resources.energy.current, scenarios.H.characters.a.resources.energy.current - 4);
});

test("Scenario I merges simultaneous repeated status attempts by registry policy", () => {
  const result = engine.resolveTurn(clone(scenarios.I));
  const marked = result.characters.d.statuses.find((status) => status.id === "marked");
  assert.ok(marked);
  assert.equal(marked.stacking_rule, "stack");
  assert.ok(marked.intensity > 100);
  assert.ok(result.world.previous_turn.status_changes.some((change) => change.statusId === "marked"));
});

test("Scenario J resolves conflicting assignment claims without last-write-wins", () => {
  const forward = engine.resolveTurn(clone(scenarios.J));
  const reversed = clone(scenarios.J);
  reversed.actions.reverse();
  const backward = engine.resolveTurn(reversed);
  assert.equal(forward.conflicts[0].code, "GEOMETRY_ASSIGNMENT_CONFLICT");
  assert.deepEqual(forward.characters.d.transform.position, { x: 10, y: 0, z: 0 });
  assert.deepEqual(forward.characters.d.transform.position, backward.characters.d.transform.position);
});

test("Scenario K aborts before commit when a multi-hit cost cannot be reserved", () => {
  const before = stableStringify(scenarios.K);
  const result = engine.resolveTurn(clone(scenarios.K));
  assert.equal(result.outcome, "aborted");
  assert.equal(stableStringify(scenarios.K), before);
  assert.deepEqual(result.characters, scenarios.K.characters);
});

test("Scenario L automatically falls back when per-hit statuses make batching unsafe", () => {
  const result = engine.resolveTurn(clone(scenarios.L));
  assert.equal(result.actionResults[0].resolutionMode, "individual");
  assert.ok(result.actionResults[0].batchSafetyReasons.includes("unaggregated_status_transition"));
  assert.equal(result.actionResults[0].representedHitCount, 30);
});

test("batch-safe individual and batched results remain within configured tolerances", () => {
  const comparison = compareBatchEquivalence(engine, scenarios.C);
  assert.equal(comparison.classifiedBatchSafe, true);
  assert.equal(comparison.withinTolerance, true);
  assert.equal(comparison.validClassification, true);
  assert.equal(comparison.divergence.hitCountAbsolute, 0);
  assert.equal(comparison.divergence.targetAllocationEqual, true);
});

test("all configured status policies are deterministic and registry-owned", () => {
  const base = [{ id: "s", source_ref: "old", intensity: 2, remaining_turns: 1, stacking_rule: "refresh", tags: [] }];
  const addition = [{ characterId: "x", statusId: "s", sourceRef: "new", intensity: 3, remainingTurns: 4 }];
  for (const policy of ["refresh", "stack", "replace", "ignore", "strongest_wins"]) {
    const definitions = { s: { merge_policy: policy, priority: 0, max_stacks: 5, intensity_cap: 100, duration_cap: 10, tags: [] } };
    const first = mergeStatuses(base, addition, [], definitions);
    const second = mergeStatuses(base, addition, [], definitions);
    assert.deepEqual(first, second);
    assert.equal(first.statuses[0].stacking_rule, policy);
  }
});

test("invalid target references fail before commit and leave caller state unchanged", () => {
  const input = clone(scenarios.A);
  input.actions[0].targets[0].ref = "missing";
  const before = stableStringify(input);
  assert.throws(() => engine.resolveTurn(input), /invalid target reference/);
  assert.equal(stableStringify(input), before);
});

test("declaration order does not change simultaneous mechanics", () => {
  const forward = engine.resolveTurn(clone(scenarios.E));
  const reversedInput = clone(scenarios.E);
  reversedInput.actions.reverse();
  const reversed = engine.resolveTurn(reversedInput);
  assert.equal(forward.resultHash, reversed.resultHash);
  assert.deepEqual(forward.characters, reversed.characters);
});

test("turn trace suppression cannot change mechanics", () => {
  const withTrace = engine.resolveTurn({ ...clone(scenarios.E), trace: true });
  const withoutTrace = engine.resolveTurn({ ...clone(scenarios.E), trace: false });
  assert.equal(withoutTrace.trace, undefined);
  assert.equal(withTrace.resultHash, withoutTrace.resultHash);
  assert.deepEqual(withTrace.characters, withoutTrace.characters);
  assert.deepEqual(withTrace.world, withoutTrace.world);
});
