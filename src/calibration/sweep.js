import { applyTuningOverrides, cartesianSweep } from "../tuning.js";
import { summarize, rankedSuspicious } from "./statistics.js";

export function runParameterSweep({ baseConfig, dimensions, repeats, createEngine, encounterFactory, metric, suspicionScore }) {
  const combinations = cartesianSweep(dimensions);
  const rows = combinations.map((overrides, combinationIndex) => {
    const config = applyTuningOverrides(baseConfig, overrides);
    const engine = createEngine(config);
    const values = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const input = encounterFactory(engine, `sweep:${combinationIndex}:${repeat}`);
      values.push(metric(engine.resolveEncounter(input)));
    }
    return { combinationIndex, overrides, metric: summarize(values) };
  });
  return {
    dimensions,
    repeats,
    combinationCount: combinations.length,
    rows,
    rankedSuspicious: rankedSuspicious(rows, suspicionScore)
  };
}

function csvCell(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function sweepToCsv(result) {
  const headers = ["rank", "combinationIndex", ...result.dimensions.map((dimension) => dimension.pointer), "count", "minimum", "maximum", "mean", "median", "p95", "standardDeviation", "suspicionScore"];
  const ranked = new Map(result.rankedSuspicious.map((row, index) => [row.combinationIndex, { rank: index + 1, score: row.suspicionScore }]));
  const rows = result.rows.map((row) => {
    const rank = ranked.get(row.combinationIndex);
    const valuesByPointer = Object.fromEntries(row.overrides.map((override) => [override.pointer, override.value]));
    return [rank?.rank ?? "", row.combinationIndex, ...result.dimensions.map((dimension) => valuesByPointer[dimension.pointer]), row.metric.count, row.metric.minimum, row.metric.maximum, row.metric.mean, row.metric.median, row.metric.p95, row.metric.standardDeviation, rank?.score ?? 0];
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
