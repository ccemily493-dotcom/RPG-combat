import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPenetrationToFilter,
  combineSequentialFilters,
  microVariance,
  planMultiAttack,
  receivedNormalPower
} from "../src/index.js";
import { clone, deterministicNumbers, loadFixture } from "./helpers.js";

test("property: defense filter never leaves [0, 1]", () => {
  const values = deterministicNumbers(20000);
  for (let index = 0; index < values.length; index += 2) {
    const combined = combineSequentialFilters(values[index] * 140 - 20, values[index + 1] * 140 - 20);
    assert.ok(combined >= 0 && combined <= 1);
  }
});

test("property: micro-variance remains inside configured bounds", async () => {
  const { engine } = await loadFixture();
  const minimum = engine.config.specs["attack.yaml"].micro_variance.minimum_factor.value;
  const maximum = engine.config.specs["attack.yaml"].micro_variance.maximum_factor.value;
  for (let index = 0; index < 100000; index += 1) {
    const variance = microVariance(engine.config, { seed: index, simulationId: "p", turn: 0, actionId: "a", targetId: "t", component: "power" });
    assert.ok(variance.factor >= minimum && variance.factor <= maximum);
  }
});

test("property: increased penetration cannot increase effective defense", () => {
  const values = deterministicNumbers(30000, 42);
  for (let index = 0; index < values.length; index += 3) {
    const filter = values[index] * 100;
    const compatibility = values[index + 1];
    const low = values[index + 2];
    const high = low + (1 - low) * values[(index + 7) % values.length];
    assert.ok(applyPenetrationToFilter(filter, high, compatibility) <= applyPenetrationToFilter(filter, low, compatibility) + 1e-12);
  }
});

test("property: increased compatible defense cannot increase received normal damage", () => {
  const values = deterministicNumbers(30000, 84);
  for (let index = 0; index < values.length; index += 3) {
    const power = values[index] * 1000;
    const body = values[index + 1] * 100;
    const low = values[index + 2] * 100;
    const high = low + (100 - low) * values[(index + 11) % values.length];
    assert.ok(receivedNormalPower(power, high, body) <= receivedNormalPower(power, low, body) + 1e-12);
  }
});

test("100% effective defense filters all filterable damage", () => {
  assert.equal(receivedNormalPower(100, 100, 0), 0);
});

test("0% defense filters none when intrinsic resistance is also zero", () => {
  assert.equal(receivedNormalPower(100, 0, 0), 100);
});

test("unavailable resources prevent the action and preserve snapshots", async () => {
  const { engine, fixture } = await loadFixture();
  const input = clone(fixture);
  input.actor.resources.energy.current = 0;
  const before = JSON.stringify(input);
  const result = engine.resolveEncounter(input);
  assert.equal(result.outcome, "invalid");
  assert.equal(result.reason, "insufficient_resources");
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.actor.resources.energy.current, 0);
  assert.equal(result.target.resources.health.current, input.target.resources.health.current);
});

test("identical snapshot, action, configuration, and seed are byte-identical", async () => {
  const { engine, fixture } = await loadFixture();
  const first = engine.resolveEncounter(clone(fixture));
  const second = engine.resolveEncounter(clone(fixture));
  assert.deepEqual(first, second);
});

test("multi-attack planning conserves count, power, and cost totals", async () => {
  const { engine } = await loadFixture();
  for (const quantity of [1, 2, 24, 25, 63, 1000]) {
    const plan = planMultiAttack(engine.config, quantity, 3.25, { energy: 7 });
    assert.equal(plan.representedCount, quantity);
    assert.equal(plan.representedPower, plan.totalPower);
    assert.deepEqual(plan.costTotals, { energy: 7 });
    assert.equal(plan.mode, quantity <= 24 ? "individual" : "batch");
  }
});
