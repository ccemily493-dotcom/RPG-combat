function warning(code, expectation, observed, context = {}, severity = "inspect") {
  return { classification: "balance_expectation", nonBlocking: true, code, expectation, observed, severity, context };
}

function outside(value, range) {
  return value < range[0] || value > range[1];
}

export function evaluateBalanceExpectations(config, observations) {
  const balance = config.specs["balance.yaml"];
  const warnings = [];
  const margins = observations.equalTierBalancedMargins ?? [];
  if (margins.length) {
    const span = Math.max(...margins) - Math.min(...margins);
    const maximum = balance.accuracy.equal_tier_structural_drift.maximum_balanced_margin_span.value;
    if (span > maximum) warnings.push(warning(balance.accuracy.equal_tier_structural_drift.warning_code, { maximumSpan: maximum }, { span, margins }));
  }
  if (Number.isFinite(observations.averageDefenseEffectiveness)) {
    const range = balance.defense.average_effectiveness.expected_range;
    if (outside(observations.averageDefenseEffectiveness, range)) warnings.push(warning(balance.defense.average_effectiveness.warning_code, { range }, { average: observations.averageDefenseEffectiveness }));
  }
  if (Number.isFinite(observations.defenseSpecialistP95)) {
    const maximum = balance.defense.specialist_tail.p95_maximum.value;
    if (observations.defenseSpecialistP95 > maximum) warnings.push(warning(balance.defense.specialist_tail.warning_code, { maximum }, { p95: observations.defenseSpecialistP95 }));
  }
  for (const [gap, summary] of Object.entries(observations.damageByGap ?? {})) {
    const expectationId = { equal: "equal_category", one_category: "one_category_gap", two_categories: "two_category_gap", extreme: "extreme_gap" }[gap] ?? gap;
    const expectation = balance.damage_expectations[expectationId];
    if (!expectation || !Number.isFinite(summary.mean)) continue;
    if (outside(summary.mean, expectation.average_range)) {
      warnings.push(warning(`${balance.damage_expectations.warning_code_prefix}_${gap.toUpperCase()}`, { averageRange: expectation.average_range }, { average: summary.mean, p05: summary.p05, p95: summary.p95 }, { gap }));
    }
  }
  if (Number.isFinite(observations.glassCannonP95) && Number.isFinite(observations.glassCannonGapAverage)) {
    const limit = balance.tails.glass_cannon.p95_multiplier_over_gap_average.value;
    const ratio = observations.glassCannonGapAverage === 0 ? Infinity : observations.glassCannonP95 / observations.glassCannonGapAverage;
    if (ratio > limit) warnings.push(warning(balance.tails.glass_cannon.warning_code, { maximumRatio: limit }, { ratio, p95: observations.glassCannonP95 }));
  }
  return warnings.sort((a, b) => a.code.localeCompare(b.code));
}

export function validationClassSummary(config) {
  return {
    hardInvariants: config.specs["invariants.yaml"].validation_classes.hard_invariant,
    balanceExpectations: config.specs["invariants.yaml"].validation_classes.balance_expectation
  };
}
