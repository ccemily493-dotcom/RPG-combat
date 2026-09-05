# v0.1.1 Damage Sensitivity

## Category-gap distributions

| Gap | Samples | Mean | Median | P05 | P95 | Maximum |
|---|---:|---:|---:|---:|---:|---:|
| equal | 4608 | 11.33 | 11.62 | 0.00 | 20.15 | 27.35 |
| one_category | 3840 | 28.79 | 28.13 | 13.11 | 46.32 | 61.89 |
| two_categories | 3072 | 56.17 | 55.41 | 32.92 | 82.45 | 111.22 |
| extreme | 768 | 125.74 | 118.13 | 99.18 | 162.38 | 163.88 |

## Fighter vs Civilian: why damage is about 58.8

| Stage | Mean |
|---|---:|
| basePower | 64.0000 |
| variedPower | 63.9745 |
| accuracyExposure | 0.8320 |
| contactPower | 53.2251 |
| activeDefenseFilter | 0.0066 |
| baseBodyFilter | 0.2075 |
| bodyAfterPenetration | 0.1660 |
| combinedFilter | 0.1716 |
| residualPower | 44.0932 |
| harmCapacityScale | 0.7500 |
| healthDamage | 58.7914 |

The balanced Fighter starts at 64.00 power, retains 83.20% through partial-hit exposure, and faces only 17.16% combined filtering. Residual power is then divided by a Civilian harm-capacity scale of 0.75, lifting average health damage to 58.79.

## Recommendations

- Do not change physical power, body resistance, or harm-capacity coefficients independently until target damage ranges are chosen for each category gap.
- Fighter vs Civilian is amplified by three effects: Fighter physical capability raises delivered power, a partial-hit exposure remains high, and Civilian harm capacity is below the 100-point reference scale.
- Review glass-cannon and defense-specialist tails before using balanced means as tuning targets; specialization is intentionally large within overlapping category ranges.
- Establish human-approved damage bands for equal, one-category, two-category, and extreme gaps before promoting any balance expectation to a test.
