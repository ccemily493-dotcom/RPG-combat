import test from "node:test";
import assert from "node:assert/strict";
import { clone, loadFixture } from "./helpers.js";

test("reference encounter exercises the complete vertical slice", async () => {
  const { engine, fixture } = await loadFixture();
  const result = engine.resolveEncounter(clone(fixture));
  assert.ok(["graze", "partial", "solid"].includes(result.quality));
  assert.ok(result.trace.offense.varied.power.factor >= 0.99);
  assert.ok(result.trace.timing.factor >= 0.1);
  assert.equal(result.trace.defense.method, "block");
  assert.ok(result.trace.defense.prePenetrationFilter >= result.defenseFilterPercent);
  assert.equal(result.trace.damage.zoneId, "core");
  assert.ok(result.healthDamage > 0);
  assert.ok(result.stabilityDamage > 0);
  assert.equal(result.actor.resources.energy.current, fixture.actor.resources.energy.current - 10);
  assert.ok(result.target.resources.energy.current < fixture.target.resources.energy.current);
  assert.ok(result.target.statuses.some((status) => status.id === "disrupted"));
  assert.equal(result.world.previous_turn.action_refs[0], fixture.action.id);
  assert.equal(result.world.turn, fixture.world.turn + 1);
  assert.ok(result.trace.stateMutations.length > 0);
});

test("explicit immunity predicate suppresses channel harm and its status", async () => {
  const { engine, fixture } = await loadFixture();
  const input = clone(fixture);
  input.action.attack.channels = { electrical: 1 };
  input.target.statuses.push({
    id: "insulated",
    source_ref: "test",
    intensity: 1,
    remaining_turns: null,
    stacking_rule: "reject",
    tags: ["immunity:electrical"]
  });
  const result = engine.resolveEncounter(input);
  assert.equal(result.healthDamage, 0);
  assert.ok(result.trace.damage.channels.every((channel) => channel.immunity));
  assert.ok(result.trace.statuses.every((status) => status.immune));
  assert.equal(result.target.statuses.some((status) => status.id === "disrupted"), false);
});

test("trace emission can be disabled without changing mechanics", async () => {
  const { engine, fixture } = await loadFixture();
  const withTrace = engine.resolveEncounter({ ...clone(fixture), trace: true });
  const withoutTrace = engine.resolveEncounter({ ...clone(fixture), trace: false });
  assert.equal(withoutTrace.trace, undefined);
  assert.equal(withTrace.healthDamage, withoutTrace.healthDamage);
  assert.equal(withTrace.stabilityDamage, withoutTrace.stabilityDamage);
  assert.deepEqual(withTrace.actor, withoutTrace.actor);
  assert.deepEqual(withTrace.target, withoutTrace.target);
  assert.deepEqual(withTrace.world, withoutTrace.world);
});
