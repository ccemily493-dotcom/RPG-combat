import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePredicate, resolveModifiers } from "../src/index.js";

const modifiers = [
  { id: "w", layer: "WORLD", target: "attack.power", operation: "additive", value: 10, stacking_rule: "stack" },
  { id: "c", layer: "CHARACTER", target: "attack.power", operation: "percentage", value: 20, stacking_rule: "stack" },
  { id: "a", layer: "ACTION", target: "attack.power", operation: "multiplicative", value: 2, stacking_rule: "stack" },
  { id: "cap", layer: "ACTION", target: "attack.power", operation: "bounded", upper: 100, stacking_rule: "stack" }
];

test("modifier phases and layers are deterministic", () => {
  const expected = resolveModifiers(30, "attack.power", [modifiers], {}, {}).finalValue;
  assert.equal(expected, 96);
  for (const reordered of [[...modifiers].reverse(), [modifiers[2], modifiers[0], modifiers[3], modifiers[1]]]) {
    assert.equal(resolveModifiers(30, "attack.power", [reordered], {}, {}).finalValue, expected);
  }
});

test("conditional predicate AST is read-only and supports registered nodes", () => {
  const context = Object.freeze({ action: Object.freeze({ tags: Object.freeze(["aimed"]), attack: Object.freeze({ power: 10 }) }) });
  assert.equal(evaluatePredicate({ has_tag: { subject: "action", tag: "aimed" } }, context), true);
  assert.equal(evaluatePredicate({ compare: { left: "action.attack.power", operator: "gte", right: 10 } }, context), true);
  assert.equal(evaluatePredicate({ not: { compare: { left: "action.attack.power", operator: "lt", right: 10 } } }, context), true);
  assert.equal(context.action.attack.power, 10);
});
