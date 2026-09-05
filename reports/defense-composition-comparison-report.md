# v0.1.1 Defense Composition Comparison

All alternatives are evaluated from canonical trace factors. They do not replace or modify engine mechanics.

## Model distributions

| Model | Mean filter | Median | P05 | P95 |
|---|---:|---:|---:|---:|
| A. Current fully multiplicative | 5.52% | 3.34% | 1.65% | 14.52% |
| B. Weighted composition followed by bounded multipliers | 27.35% | 25.24% | 15.66% | 45.13% |
| C. Grouped execution/timing and compatibility/coverage | 16.59% | 14.37% | 8.07% | 32.10% |

## Canonical factors

| Factor | Mean | Median | P05 | P95 |
|---|---:|---:|---:|---:|
| capacity | 0.513 | 0.494 | 0.330 | 0.721 |
| feasibility | 1.000 | 1.000 | 1.000 | 1.000 |
| execution | 0.676 | 0.662 | 0.438 | 0.963 |
| timing | 0.311 | 0.309 | 0.201 | 0.461 |
| compatibility | 0.850 | 0.850 | 0.850 | 0.850 |
| coverage | 0.630 | 0.630 | 0.630 | 0.630 |
| stability | 1.000 | 1.000 | 1.000 | 1.000 |
| paid_fraction | 1.000 | 1.000 | 1.000 | 1.000 |
| penetration | 0.840 | 0.840 | 0.839 | 0.841 |
| energy_efficiency | 0.780 | 0.760 | 0.625 | 0.975 |

## Cumulative collapse ranking

| Stage | Mean absolute collapse | Mean stage factor |
|---|---:|---:|
| capacity | 48.70% | 0.513 |
| timing | 24.69% | 0.311 |
| execution | 14.35% | 0.676 |
| coverage | 3.86% | 0.630 |
| compatibility | 1.84% | 0.850 |
| penetration | 1.05% | 0.840 |
| feasibility | 0.00% | 1.000 |
| stability | 0.00% | 1.000 |
| paid_fraction | 0.00% | 1.000 |

## Recommendations

- The largest absolute canonical collapse is currently capacity (mean loss 48.70 percentage points of the original unit interval at that stage). Inspect this factor before changing base defense capacity.
- Compare desired fiction for fast attacks against the timing floor: low timing factors dominate many cohorts and then multiply with coverage and compatibility.
- Use model B to study a compensatory weighted skill envelope and model C to study grouped competencies; neither is authorized as canonical.
- Energy efficiency currently changes affordability rather than directly multiplying filtering. Keep it visible as a diagnostic so cost failures are not mistaken for composition collapse.
