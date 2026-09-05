# v0.2 Defense Composition Comparison

The weighted model is canonical. The fully multiplicative and grouped models remain diagnostic comparisons.

## Model distributions

| Model | Mean filter | Median | P05 | P95 |
|---|---:|---:|---:|---:|
| A. Current fully multiplicative | 6.45% | 4.48% | 1.65% | 14.86% |
| B. Weighted composition followed by bounded multipliers | 29.12% | 27.57% | 15.78% | 45.38% |
| C. Grouped execution/timing and compatibility/coverage | 18.15% | 15.78% | 8.12% | 32.45% |

## Canonical factors

| Factor | Mean | Median | P05 | P95 |
|---|---:|---:|---:|---:|
| capacity | 0.534 | 0.541 | 0.330 | 0.721 |
| feasibility | 1.000 | 1.000 | 1.000 | 1.000 |
| execution | 0.706 | 0.712 | 0.438 | 0.972 |
| timing | 0.329 | 0.335 | 0.202 | 0.469 |
| compatibility | 0.850 | 0.850 | 0.850 | 0.850 |
| coverage | 0.630 | 0.630 | 0.630 | 0.630 |
| stability | 1.000 | 1.000 | 1.000 | 1.000 |
| bounded_stability | 1.000 | 1.000 | 1.000 | 1.000 |
| weighted_performance | 0.633 | 0.611 | 0.526 | 0.752 |
| paid_fraction | 1.000 | 1.000 | 1.000 | 1.000 |
| penetration | 0.840 | 0.840 | 0.839 | 0.841 |
| energy_efficiency | 0.799 | 0.797 | 0.625 | 0.975 |

## Cumulative collapse ranking

| Stage | Mean absolute collapse | Mean stage factor |
|---|---:|---:|
| capacity | 46.64% | 0.534 |
| weighted_performance | 18.69% | 0.633 |
| penetration | 5.55% | 0.840 |
| bounded_stability | 0.00% | 1.000 |
| feasibility | 0.00% | 1.000 |
| paid_fraction | 0.00% | 1.000 |

## Recommendations

- The largest absolute canonical weighted-stage collapse is currently capacity (mean loss 46.64 percentage points at that stage).
- Compatibility and coverage remain explicit weighted contributions plus zero-applicability gates; timing and execution remain independently traceable.
- The weighted model is now canonical. Fully multiplicative and grouped models remain comparison profiles only.
- Energy efficiency currently changes affordability rather than directly multiplying filtering. Keep it visible as a diagnostic so cost failures are not mistaken for composition collapse.
