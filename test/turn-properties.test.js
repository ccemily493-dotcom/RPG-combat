import test from "node:test";
import assert from "node:assert/strict";
import {
  actionCostPlan,
  boundedHarmCapacityMultiplier,
  compareBatchEquivalence
} from "../src/index.js";
import { clone, loadScenarioFixture } from "./helpers.js";

const { engine, scenarios } = await loadScenarioFixture();

test("property: bounded harm-capacity vulnerability is finite, bounded, and monotonic", () => {
  let previous = Infinity;
  for (let capacity = 0; capacity <= 250; capacity += 0.25) {
    const result = boundedHarmCapacityMultiplier(engine.config, capacity);
    assert.ok(Number.isFinite(result.multiplier));
    assert.ok(result.multiplier >= 1 && result.multiplier <= 1.35);
    assert.ok(result.multiplier <= previous + 1e-12);
    previous = result.multiplier;
  }
});

test("property: all normalized cost modes reserve deterministic quantity-aware totals", () => {
  for (const quantity of [1, 3, 10, 50, 500]) {
    const action = clone(scenarios.B.actions[0]);
    action.attack.quantity = quantity;
    action.costs = [{ resource: "energy", amount: 7, timing: "on_attempt", mode: "PER_ACTION" }];
    assert.equal(actionCostPlan(action)[0].maximumAmount, 7);
    action.costs = [{ resource: "energy", amount: 2, timing: "on_attempt", mode: "PER_HIT" }];
    assert.equal(actionCostPlan(action)[0].maximumAmount, quantity * 2);
    action.costs = [{ resource: "energy", amount: 11, timing: "on_attempt", mode: "SHARED_POOL" }];
    assert.equal(actionCostPlan(action)[0].maximumAmount, 11);
    action.costs = [{ resource: "energy", amount: 0, timing: "on_attempt", mode: "UPFRONT_PLUS_PER_HIT", upfront_amount: 5, per_hit_amount: 3 }];
    assert.equal(actionCostPlan(action)[0].maximumAmount, 5 + quantity * 3);
  }
});

test("property: resource conservation holds across representative multi-hit quantities", () => {
  for (const quantity of [1, 3, 10, 50]) {
    const input = clone(scenarios.B);
    input.id = `resource-${quantity}`;
    input.world.simulation_id = input.id;
    input.seed = input.id;
    input.actions[0].attack.quantity = quantity;
    input.actions[0].costs = [{ resource: "energy", amount: 2, timing: "on_attempt", mode: "PER_HIT" }];
    const before = input.characters.a.resources.energy.current;
    const result = engine.resolveTurn(input);
    assert.equal(result.outcome, "committed");
    assert.equal(result.characters.a.resources.energy.current, before - quantity * 2);
    assert.equal(result.actionResults[0].representedHitCount, quantity);
  }
});

test("property: reaction capacity is never exceeded or made negative", () => {
  for (let capacity = 0; capacity <= 3; capacity += 1) {
    const input = clone(scenarios.G);
    input.characters.b.action_economy.reaction_capacity = capacity;
    input.characters.b.action_economy.reactions_remaining = capacity;
    input.characters.b.action_economy.reaction_available = capacity > 0;
    const result = engine.resolveTurn(input);
    const consumed = result.reactionResults.filter((reaction) => ["applied", "failed"].includes(reaction.outcome)).length;
    assert.ok(consumed <= capacity);
    assert.ok(result.characters.b.action_economy.reactions_remaining >= 0);
  }
});

test("property: declaration permutations preserve simultaneous additive results", () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const forwardInput = clone(scenarios.E);
    forwardInput.seed = `permutation:${seed}`;
    const reverseInput = clone(forwardInput);
    reverseInput.actions.reverse();
    const forward = engine.resolveTurn(forwardInput);
    const reverse = engine.resolveTurn(reverseInput);
    assert.equal(forward.resultHash, reverse.resultHash);
    assert.deepEqual(forward.characters, reverse.characters);
  }
});

test("property: batch-safe certification conserves all configured dimensions", () => {
  for (const quantity of [50, 100, 500]) {
    const input = clone(scenarios.C);
    input.id = `batch-equivalence-${quantity}`;
    input.world.simulation_id = input.id;
    input.seed = input.id;
    input.actions[0].attack.quantity = quantity;
    const comparison = compareBatchEquivalence(engine, input);
    assert.equal(comparison.validClassification, true);
    assert.equal(comparison.divergence.hitCountAbsolute, 0);
    assert.equal(comparison.divergence.statusCountAbsolute, 0);
    assert.equal(comparison.divergence.targetAllocationEqual, true);
  }
});

test("property: duplicate reaction declarations are rejected before resolution", () => {
  const input = clone(scenarios.F);
  input.reactions.push(clone(input.reactions[0]));
  assert.throws(() => engine.resolveTurn(input), /Duplicate reaction id/);
});

test("property: invalid registry entries fail formal schema validation", () => {
  const defense = clone(scenarios.F);
  defense.registries.defense_sources["shield.basic"].compatibility.kinetic = 2;
  assert.throws(() => engine.resolveTurn(defense), /turn failed JSON Schema validation/);
  const status = clone(scenarios.I);
  status.registries.status_definitions.marked.merge_policy = "invented";
  assert.throws(() => engine.resolveTurn(status), /turn failed JSON Schema validation/);
});

test("property: complete turn replay is deterministic across representative scenarios", () => {
  for (const id of ["A", "C", "D", "E", "G", "H", "I", "J", "L"]) {
    assert.equal(engine.replayTurn(clone(scenarios[id])).deterministic, true, id);
  }
});
