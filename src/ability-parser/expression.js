import { getPath, roundTo } from "../utils.js";
import { parserError } from "./errors.js";

export const EXPRESSION_OPERATIONS = Object.freeze(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MIN", "MAX", "CLAMP", "ABS"]);
const OP_SET = new Set(EXPRESSION_OPERATIONS);

export function isExpression(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (keys.length === 1 && (keys[0] === "ref" || keys[0] === "const"))
    || (keys.length === 2 && keys.includes("op") && keys.includes("args"));
}

function assertShape(expression, path) {
  const keys = Object.keys(expression).sort();
  if (keys.length !== 1 && !(keys.length === 2 && keys.includes("op") && keys.includes("args"))) {
    throw parserError("EXPRESSION_ERROR", "Expression nodes contain only const, ref, or op+args.", path);
  }
  if (Object.hasOwn(expression, "const")) {
    if (keys.length !== 1 || !Number.isFinite(expression.const)) throw parserError("EXPRESSION_ERROR", "Expression constant must be finite.", path);
    return "const";
  }
  if (Object.hasOwn(expression, "ref")) {
    if (keys.length !== 1 || typeof expression.ref !== "string" || !expression.ref.length) throw parserError("EXPRESSION_ERROR", "Expression reference must be a non-empty string.", path);
    return "ref";
  }
  if (!OP_SET.has(expression.op) || !Array.isArray(expression.args)) throw parserError("EXPRESSION_ERROR", `Unsupported expression operation ${String(expression.op)}.`, path);
  const count = expression.args.length;
  if ((expression.op === "ABS" && count !== 1) || (["DIVIDE"].includes(expression.op) && count !== 2)
    || (expression.op === "CLAMP" && count !== 3) || (expression.op === "SUBTRACT" && count < 2)
    || (["ADD", "MULTIPLY", "MIN", "MAX"].includes(expression.op) && count < 1)) {
    throw parserError("EXPRESSION_ERROR", `Invalid argument count for ${expression.op}.`, path);
  }
  return "op";
}

export function validateExpression(expression, options = {}) {
  const maxDepth = options.maxDepth ?? 16;
  const maxNodes = options.maxNodes ?? 128;
  const referenceAllowed = options.referenceAllowed ?? (() => true);
  let nodes = 0;
  let deepest = 0;
  const references = new Set();
  function visit(node, depth, path) {
    if (!isExpression(node)) throw parserError("EXPRESSION_ERROR", "Expected a declarative expression node.", path);
    nodes += 1;
    deepest = Math.max(deepest, depth);
    if (nodes > maxNodes) throw parserError("EXPRESSION_ERROR", `Expression exceeds ${maxNodes} nodes.`, path);
    if (depth > maxDepth) throw parserError("EXPRESSION_ERROR", `Expression exceeds depth ${maxDepth}.`, path);
    const kind = assertShape(node, path);
    if (kind === "ref") {
      if (!referenceAllowed(node.ref)) throw parserError("REFERENCE_ERROR", `Undeclared or forbidden expression reference ${node.ref}.`, path);
      references.add(node.ref);
    } else if (kind === "op") {
      node.args.forEach((child, index) => visit(child, depth + 1, `${path}.args[${index}]`));
    }
  }
  visit(expression, 1, options.path ?? "expression");
  return Object.freeze({ nodes, depth: deepest, references: Object.freeze([...references].sort()) });
}

export function evaluateExpression(expression, bindings, path = "expression") {
  const kind = assertShape(expression, path);
  if (kind === "const") return expression.const;
  if (kind === "ref") {
    const value = getPath(bindings, expression.ref);
    if (!Number.isFinite(value)) throw parserError("EXPRESSION_ERROR", `Reference ${expression.ref} did not resolve to a finite number.`, path);
    return value;
  }
  const values = expression.args.map((child, index) => evaluateExpression(child, bindings, `${path}.args[${index}]`));
  let value;
  if (expression.op === "ADD") value = values.reduce((sum, item) => sum + item, 0);
  else if (expression.op === "SUBTRACT") value = values.slice(1).reduce((result, item) => result - item, values[0]);
  else if (expression.op === "MULTIPLY") value = values.reduce((product, item) => product * item, 1);
  else if (expression.op === "DIVIDE") {
    if (values[1] === 0) throw parserError("EXPRESSION_ERROR", "Division by zero is forbidden.", path);
    value = values[0] / values[1];
  } else if (expression.op === "MIN") value = Math.min(...values);
  else if (expression.op === "MAX") value = Math.max(...values);
  else if (expression.op === "CLAMP") value = Math.min(values[2], Math.max(values[0], values[1]));
  else value = Math.abs(values[0]);
  if (!Number.isFinite(value)) throw parserError("EXPRESSION_ERROR", "Expression produced NaN or Infinity.", path);
  return roundTo(value);
}

export function walkExpressions(value, visitor, path = "value") {
  if (isExpression(value)) return visitor(value, path);
  if (Array.isArray(value)) return value.map((item, index) => walkExpressions(item, visitor, `${path}[${index}]`));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walkExpressions(item, visitor, `${path}.${key}`)]));
  return value;
}
