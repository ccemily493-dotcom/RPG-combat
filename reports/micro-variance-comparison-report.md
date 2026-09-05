# v0.1.1 Micro-Variance Comparison

| Distribution | Mean factor | Standard deviation | Minimum | Maximum | Max absolute deviation |
|---|---:|---:|---:|---:|---:|
| uniform | 1.0000092 | 0.0057822 | 0.9900008 | 1.0099998 | 0.0099998 |
| centered_triangular | 1.0000082 | 0.0040806 | 0.9900814 | 1.0099597 | 0.0099597 |
| bounded_normal_like | 1.0000168 | 0.0023708 | 0.9906528 | 1.0084709 | 0.0093472 |

All sampled values remained inside 0.99–1.01. Centered distributions are visibly narrower while remaining deterministic and bounded.

## Defense-boundary behavior

| Distribution | Base filter | Mean output | P05 | P95 | Clipped at 0 | Clipped at 100 |
|---|---:|---:|---:|---:|---:|---:|
| uniform | 0.0% | 0.0000% | 0.0000% | 0.0000% | 100.00% | 0.00% |
| uniform | 0.1% | 0.1000% | 0.0991% | 0.1009% | 0.00% | 0.00% |
| uniform | 1.0% | 1.0000% | 0.9910% | 1.0090% | 0.00% | 0.00% |
| uniform | 99.0% | 99.0009% | 98.1063% | 99.8913% | 0.00% | 0.00% |
| uniform | 99.9% | 99.6981% | 98.9982% | 100.0000% | 0.00% | 45.07% |
| uniform | 100.0% | 99.7502% | 99.0973% | 100.0000% | 0.00% | 50.12% |
| centered_triangular | 0.0% | 0.0000% | 0.0000% | 0.0000% | 100.00% | 0.00% |
| centered_triangular | 0.1% | 0.1000% | 0.0993% | 0.1007% | 0.00% | 0.00% |
| centered_triangular | 1.0% | 1.0000% | 0.9932% | 1.0069% | 0.00% | 0.00% |
| centered_triangular | 99.0% | 99.0008% | 98.3223% | 99.6790% | 0.00% | 0.00% |
| centered_triangular | 99.9% | 99.7793% | 99.2162% | 100.0000% | 0.00% | 40.51% |
| centered_triangular | 100.0% | 99.8340% | 99.3155% | 100.0000% | 0.00% | 50.10% |
| bounded_normal_like | 0.0% | 0.0000% | 0.0000% | 0.0000% | 100.00% | 0.00% |
| bounded_normal_like | 0.1% | 0.1000% | 0.0996% | 0.1004% | 0.00% | 0.00% |
| bounded_normal_like | 1.0% | 1.0000% | 0.9961% | 1.0039% | 0.00% | 0.00% |
| bounded_normal_like | 99.0% | 99.0017% | 98.6152% | 99.3891% | 0.00% | 0.00% |
| bounded_normal_like | 99.9% | 99.8476% | 99.5117% | 100.0000% | 0.00% | 34.22% |
| bounded_normal_like | 100.0% | 99.9055% | 99.6113% | 100.0000% | 0.00% | 50.15% |

## Accuracy threshold flips

| Distribution | Threshold | Starting offset | Starting band | Flip rate |
|---|---:|---:|---|---:|
| uniform | -20 | -0.5 | miss | 0.00% |
| uniform | -20 | -0.1 | miss | 33.15% |
| uniform | -20 | 0 | graze | 51.30% |
| uniform | -20 | 0.1 | graze | 34.00% |
| uniform | -20 | 0.5 | graze | 0.00% |
| uniform | 0 | -0.5 | graze | 0.00% |
| uniform | 0 | -0.1 | graze | 38.70% |
| uniform | 0 | 0 | partial | 52.10% |
| uniform | 0 | 0.1 | partial | 39.30% |
| uniform | 0 | 0.5 | partial | 0.70% |
| uniform | 20 | -0.5 | partial | 13.85% |
| uniform | 20 | -0.1 | partial | 43.55% |
| uniform | 20 | 0 | solid | 48.50% |
| uniform | 20 | 0.1 | solid | 42.05% |
| uniform | 20 | 0.5 | solid | 14.65% |
| centered_triangular | -20 | -0.5 | miss | 0.00% |
| centered_triangular | -20 | -0.1 | miss | 22.35% |
| centered_triangular | -20 | 0 | graze | 50.15% |
| centered_triangular | -20 | 0.1 | graze | 22.25% |
| centered_triangular | -20 | 0.5 | graze | 0.00% |
| centered_triangular | 0 | -0.5 | graze | 0.00% |
| centered_triangular | 0 | -0.1 | graze | 30.45% |
| centered_triangular | 0 | 0 | partial | 50.80% |
| centered_triangular | 0 | 0.1 | partial | 32.30% |
| centered_triangular | 0 | 0.5 | partial | 0.00% |
| centered_triangular | 20 | -0.5 | partial | 3.85% |
| centered_triangular | 20 | -0.1 | partial | 37.80% |
| centered_triangular | 20 | 0 | solid | 48.50% |
| centered_triangular | 20 | 0.1 | solid | 36.50% |
| centered_triangular | 20 | 0.5 | solid | 4.85% |
| bounded_normal_like | -20 | -0.5 | miss | 0.00% |
| bounded_normal_like | -20 | -0.1 | miss | 7.95% |
| bounded_normal_like | -20 | 0 | graze | 50.00% |
| bounded_normal_like | -20 | 0.1 | graze | 7.90% |
| bounded_normal_like | -20 | 0.5 | graze | 0.00% |
| bounded_normal_like | 0 | -0.5 | graze | 0.00% |
| bounded_normal_like | 0 | -0.1 | graze | 19.40% |
| bounded_normal_like | 0 | 0 | partial | 50.15% |
| bounded_normal_like | 0 | 0.1 | partial | 19.05% |
| bounded_normal_like | 0 | 0.5 | partial | 0.00% |
| bounded_normal_like | 20 | -0.5 | partial | 0.10% |
| bounded_normal_like | 20 | -0.1 | partial | 29.60% |
| bounded_normal_like | 20 | 0 | solid | 50.25% |
| bounded_normal_like | 20 | 0.1 | solid | 27.30% |
| bounded_normal_like | 20 | 0.5 | solid | 0.00% |

## Recommendations

- Keep uniform canonical until humans decide whether equal endpoint density or center concentration better represents unmodeled variables.
- Centered triangular and bounded normal-like profiles reduce threshold-crossing frequency without changing bounds; compare that behavior specifically for cases already within one margin point of a threshold.
- Do not widen the 0.99–1.01 interval to create more diverse outcomes. Accuracy-band diversity should come from modeled stats, actions, world state, and specialization.
