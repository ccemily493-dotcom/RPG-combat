# v0.2 Damage Sensitivity

## Category-gap distributions

| Gap | Samples | Mean | Median | P05 | P95 | Maximum |
|---|---:|---:|---:|---:|---:|---:|
| equal | 4608 | 17.61 | 17.51 | 10.01 | 26.28 | 29.18 |
| one_category | 3840 | 35.25 | 34.42 | 25.23 | 48.08 | 57.34 |
| two_categories | 3072 | 53.68 | 53.09 | 45.11 | 65.47 | 68.15 |
| extreme | 768 | 85.56 | 84.41 | 75.51 | 97.46 | 98.15 |

## Fighter vs Civilian canonical pipeline

| Stage | Mean |
|---|---:|
| basePower | 64.0000 |
| variedPower | 63.9650 |
| accuracyExposure | 1.0000 |
| contactPower | 63.9650 |
| activeDefenseFilter | 0.1403 |
| baseBodyFilter | 0.2075 |
| bodyAfterPenetration | 0.1660 |
| combinedFilter | 0.2830 |
| residualPower | 45.8615 |
| harmCapacityScale | 0.7500 |
| harmCapacityMultiplier | 1.1000 |
| healthDamage | 50.4477 |

The balanced Fighter starts at 64.00 power, retains 100.00% through its hit-quality exposure, and faces 28.30% combined filtering. The approved bounded harm-capacity multiplier is 1.100, producing 50.45 average health damage.

## Harm-capacity curve

| Harm capacity | Capacity ratio | Damage multiplier |
|---:|---:|---:|
| 0 | 0.00 | 1.350 |
| 25 | 0.25 | 1.350 |
| 50 | 0.50 | 1.200 |
| 75 | 0.75 | 1.100 |
| 100 | 1.00 | 1.000 |
| 150 | 1.50 | 1.000 |

## Recommendations

- Do not silently change physical power, body resistance, or the approved bounded harm-capacity curve when a soft expectation emits a warning.
- Fighter vs Civilian now uses a bounded interpolated vulnerability multiplier rather than reciprocal division by capacity.
- Review glass-cannon and defense-specialist tails before using balanced means as tuning targets; specialization is intentionally large within overlapping category ranges.
- Establish human-approved damage bands for equal, one-category, two-category, and extreme gaps before promoting any balance expectation to a test.
