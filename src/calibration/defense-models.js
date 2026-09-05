import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { clamp } from "../utils.js";
import { summarize } from "./statistics.js";

function scalar(node) {
  return node && typeof node === "object" && Object.hasOwn(node, "value") ? node.value : node;
}

export async function loadDefenseCompositionProfiles(specDir) {
  return parseYaml(await readFile(join(specDir, "experiments", "defense-composition.yaml"), "utf8"), { uniqueKeys: true });
}

export function evaluateCompositionExpression(expression, factors) {
  if (Object.hasOwn(expression, "source")) return factors[expression.source];
  if (expression.op === "product") return expression.terms.reduce((product, term) => product * evaluateCompositionExpression(term, factors), 1);
  if (expression.op === "weighted_sum") {
    const weights = expression.terms.map((term) => scalar(term.weight));
    const denominator = weights.reduce((sum, weight) => sum + Math.abs(weight), 0);
    return denominator === 0 ? 0 : expression.terms.reduce((sum, term, index) => sum + evaluateCompositionExpression(term, factors) * weights[index], 0) / denominator;
  }
  if (expression.op === "clamp") {
    return clamp(scalar(expression.minimum), scalar(expression.maximum), evaluateCompositionExpression(expression.term, factors));
  }
  throw new RangeError(`Unsupported composition expression: ${JSON.stringify(expression)}`);
}

export function defenseFactors(trace) {
  const penetration = 1 - trace.penetration * trace.penetrationCompatibility;
  return {
    capacity: trace.hookTrace.finalValue / 100,
    feasibility: trace.feasible ? 1 : 0,
    execution: trace.execution,
    timing: trace.timing,
    compatibility: trace.compatibility,
    coverage: trace.coverage,
    stability: trace.stabilityFactor,
    bounded_stability: trace.composition?.boundedStability ?? trace.stabilityFactor,
    weighted_performance: trace.composition?.weightedPerformance ?? trace.execution * trace.timing,
    paid_fraction: trace.paidFraction,
    penetration,
    energy_efficiency: trace.efficiency
  };
}

export function evaluateDefenseModels(trace, profiles) {
  const factors = defenseFactors(trace);
  return Object.fromEntries(Object.entries(profiles.models).map(([id, profile]) => {
    const beforeVariance = clamp(0, 1, evaluateCompositionExpression(profile.expression, factors));
    const afterVariance = beforeVariance === 1 ? 1 : clamp(0, 1, beforeVariance * trace.variance.factor);
    return [id, { label: profile.label, canonical: profile.canonical, beforeVariance, filter: afterVariance }];
  }));
}

export function cumulativeCanonicalStages(trace) {
  const factors = defenseFactors(trace);
  const order = ["capacity", "weighted_performance", "bounded_stability", "feasibility", "paid_fraction", "penetration"];
  let current = 1;
  return order.map((stage) => {
    const before = current;
    current *= factors[stage];
    return { stage, factor: factors[stage], before, after: current, absoluteCollapse: before - current, relativeRetention: before === 0 ? 1 : current / before };
  });
}

export function summarizeDefenseComparisons(traces, profiles) {
  const modelValues = Object.fromEntries(Object.keys(profiles.models).map((id) => [id, []]));
  const factorValues = Object.fromEntries(["capacity", "feasibility", "execution", "timing", "compatibility", "coverage", "stability", "bounded_stability", "weighted_performance", "paid_fraction", "penetration", "energy_efficiency"].map((id) => [id, []]));
  const collapses = Object.fromEntries(["capacity", "weighted_performance", "bounded_stability", "feasibility", "paid_fraction", "penetration"].map((id) => [id, []]));
  for (const trace of traces) {
    const factors = defenseFactors(trace);
    for (const [id, value] of Object.entries(factors)) factorValues[id].push(value);
    for (const [id, result] of Object.entries(evaluateDefenseModels(trace, profiles))) modelValues[id].push(result.filter);
    for (const stage of cumulativeCanonicalStages(trace)) collapses[stage.stage].push(stage.absoluteCollapse);
  }
  return {
    models: Object.fromEntries(Object.entries(modelValues).map(([id, values]) => [id, summarize(values)])),
    factors: Object.fromEntries(Object.entries(factorValues).map(([id, values]) => [id, summarize(values)])),
    stageCollapse: Object.entries(collapses)
      .map(([stage, values]) => ({ stage, ...summarize(values) }))
      .sort((a, b) => b.mean - a.mean)
  };
}
