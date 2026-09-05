import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SPEC_FILES } from "./config.js";
import { compileSchemas } from "./schema.js";

const STRUCTURAL_NUMERIC_KEYS = new Set([
  "order",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "min",
  "max",
  "min_exclusive",
  "max_exclusive"
]);

const STRUCTURAL_ARRAY_KEYS = new Set([
  "range",
  "input_range",
  "compatibility_range",
  "filter_percent_range"
]);

function inspectNumbers(node, path, issues, parent = null, key = "") {
  if (typeof node === "number") {
    const parentHasFlag = parent && typeof parent.tunable === "boolean";
    const arrayKey = path.at(-2) ?? "";
    const structural = STRUCTURAL_NUMERIC_KEYS.has(key) || STRUCTURAL_ARRAY_KEYS.has(arrayKey) || arrayKey.endsWith("_range");
    if (!Number.isFinite(node)) issues.push(`${path.join(".")}: non-finite number`);
    if (!parentHasFlag && !structural) issues.push(`${path.join(".")}: unclassified numeric literal`);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (Object.hasOwn(node, "value") && typeof node.value === "number") {
    if (typeof node.tunable !== "boolean") issues.push(`${path.join(".")}: numeric value lacks tunable flag`);
    if (node.tunable === false && typeof node.reason !== "string") {
      issues.push(`${path.join(".")}: non-tunable numeric value lacks reason`);
    }
  }
  if (Array.isArray(node)) {
    node.forEach((value, index) => inspectNumbers(value, [...path, String(index)], issues, node, String(index)));
    return;
  }
  for (const [childKey, value] of Object.entries(node)) {
    if (childKey === "tunable" || childKey === "reason") continue;
    inspectNumbers(value, [...path, childKey], issues, node, childKey);
  }
}

function near(value, expected, tolerance = 1e-9) {
  return Math.abs(value - expected) <= tolerance;
}

export async function lintSpecifications(config) {
  const issues = [];
  const stats = config.specs["stats.yaml"].stats;
  const categories = config.specs["categories.yaml"].categories;
  const defense = config.specs["defense.yaml"];
  const attack = config.specs["attack.yaml"];
  const parser = config.specs["parser.yaml"];

  if (Object.keys(stats).length !== 11) issues.push("stats.yaml: expected exactly 11 core stats");
  const schemaStats = config.schemas["character-state.schema.json"].$defs.stats.required;
  if ([...Object.keys(stats)].sort().join("|") !== [...schemaStats].sort().join("|")) {
    issues.push("character-state.schema.json: required stats do not match stats.yaml");
  }

  for (const [id, category] of Object.entries(categories)) {
    const minimum = category.range.min.value;
    const maximum = category.range.max.value;
    if (!(minimum <= category.default.value && category.default.value <= maximum)) {
      issues.push(`categories.yaml: ${id} default is outside its range`);
    }
  }

  for (const [method, definition] of Object.entries(defense.methods)) {
    const total = Object.values(definition.primary_stats).reduce((sum, weight) => sum + weight.value, 0);
    if (!near(total, 1)) issues.push(`defense.yaml: ${method} stat weights sum to ${total}`);
  }

  const accuracyDefinitions = [attack.derived_offense.physical_accuracy, attack.derived_offense.energy_accuracy, attack.derived_offense.target_evasion];
  for (const definition of accuracyDefinitions) {
    const total = Object.entries(definition)
      .filter(([key, node]) => key.endsWith("_weight") && node && typeof node.value === "number")
      .reduce((sum, [, node]) => sum + node.value, 0);
    if (!(total > 0)) issues.push("attack.yaml: normalized accuracy/evasion weights must have a positive total");
  }

  const performanceWeights = defense.composition.weighted_performance;
  const performanceTotal = ["execution_weight", "timing_weight", "compatibility_weight", "coverage_weight"]
    .reduce((sum, id) => sum + performanceWeights[id].value, 0);
  if (!near(performanceTotal, performanceWeights.weights_must_sum_to.value)) {
    issues.push(`defense.yaml: weighted composition weights sum to ${performanceTotal}`);
  }

  const validationClasses = config.specs["invariants.yaml"].validation_classes;
  if (validationClasses.balance_expectation.may_fail_build !== false) {
    issues.push("invariants.yaml: balance expectations must remain non-blocking");
  }

  const strategy = config.specs["strategy.yaml"];
  const primitiveIds = Object.keys(strategy.primitive_resolution.opposed_contests)
    .concat(Object.keys(strategy.primitive_resolution.action_backed))
    .concat(Object.keys(strategy.primitive_resolution.condition_backed))
    .concat(Object.keys(strategy.primitive_resolution.state_setup))
    .sort();
  if (new Set(primitiveIds).size !== primitiveIds.length) issues.push("strategy.yaml: primitive ids must belong to exactly one resolver class");
  const contractFields = ["requirements", "relevant_mechanical_inputs", "possible_target_state", "world_hooks", "character_hooks", "duration_contract", "counterconditions"];
  for (const primitiveId of primitiveIds) {
    const contract = strategy.primitive_contracts[primitiveId];
    if (!contract || contractFields.some((field) => !Object.hasOwn(contract, field))) issues.push(`strategy.yaml: ${primitiveId} lacks a complete primitive contract`);
  }

  const confidenceWeights = parser.confidence.weights;
  const confidenceTotal = ["lexical_weight", "pattern_weight", "entity_weight", "completeness_weight"]
    .reduce((sum, id) => sum + confidenceWeights[id].value, 0);
  if (!near(confidenceTotal, confidenceWeights.must_sum_to.value)) {
    issues.push(`parser.yaml: confidence weights sum to ${confidenceTotal}`);
  }

  for (const file of SPEC_FILES) inspectNumbers(config.specs[file], [file], issues);

  const sourceFiles = ["config.js", "schema.js", "lint.js", "immutable.js", "modifiers.js", "variance.js", "transaction.js", "multi.js", "tuning.js", "combat.js", "turn.js", "balance.js", "status.js", "replay.js", "scenarios.js", "session-scenarios.js", "session-diagnostics.js", "temporal.js", "strategy.js", "session.js", "index.js"];
  const forbidden = ["ability_parser", "universe", "openai", "anthropic", "llm", "dictionary"];
  for (const file of sourceFiles) {
    try {
      const source = await readFile(join(config.specDir, "src", file), "utf8");
      const importLines = source.split(/\r?\n/).filter((line) => /^\s*import\s/.test(line));
      for (const line of importLines) {
        for (const token of forbidden) {
          if (line.toLowerCase().includes(token)) issues.push(`src/${file}: forbidden import token ${token}`);
        }
      }
    } catch {
      issues.push(`src/${file}: expected source file is missing`);
    }
  }

  try {
    compileSchemas(config);
  } catch (error) {
    issues.push(`JSON Schema compilation failed: ${error.message}`);
  }

  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
}
