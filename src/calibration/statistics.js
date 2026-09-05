export function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function quantile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function summarize(values) {
  if (!values.length) return { count: 0, minimum: null, maximum: null, mean: null, median: null, p05: null, p95: null, standardDeviation: null };
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return {
    count: values.length,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    mean: average,
    median: quantile(values, 0.5),
    p05: quantile(values, 0.05),
    p95: quantile(values, 0.95),
    standardDeviation: Math.sqrt(variance)
  };
}

export function histogram(values, boundaries) {
  const sorted = [...boundaries].sort((a, b) => a - b);
  const buckets = Array.from({ length: sorted.length + 1 }, () => 0);
  for (const value of values) {
    const index = sorted.findIndex((boundary) => value < boundary);
    buckets[index < 0 ? sorted.length : index] += 1;
  }
  return buckets.map((count, index) => ({
    minimumInclusive: index === 0 ? null : sorted[index - 1],
    maximumExclusive: index === sorted.length ? null : sorted[index],
    count,
    fraction: values.length ? count / values.length : 0
  }));
}

export function thresholdDiagnostics(values, thresholds, nearWidths = [1, 2, 5]) {
  const nearestDistances = values.map((value) => Math.min(...thresholds.map((threshold) => Math.abs(value - threshold))));
  return {
    thresholds: thresholds.map((threshold) => ({
      threshold,
      near: Object.fromEntries(nearWidths.map((width) => [String(width), values.filter((value) => Math.abs(value - threshold) <= width).length / Math.max(1, values.length)]))
    })),
    nearestDistance: summarize(nearestDistances)
  };
}

export function rankedSuspicious(rows, score) {
  return rows
    .map((row) => ({ ...row, suspicionScore: score(row) }))
    .filter((row) => row.suspicionScore > 0)
    .sort((a, b) => b.suspicionScore - a.suspicionScore);
}
