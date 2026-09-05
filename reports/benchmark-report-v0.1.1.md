# v0.1.1 Expanded Benchmark

- Specialized fixtures: 48
- Seeded statistical encounters: 21,440
- Resolution throughput (trace suppressed): 1234 encounters/second
- Median resolution time: 0.7101 ms
- P95 resolution time: 1.1688 ms
- Median trace-emission overhead: 0.0045 ms
- Median isolated schema-validation overhead: 0.0204 ms (2.87% of median full resolution)

## Neutral controls

| Matchup | Mean margin | Mean damage | Mean stability | Mean defense |
|---|---:|---:|---:|---:|
| civilian:balanced vs civilian:balanced | -5.00 | 15.07 | 9.88 | 2.33% |
| fighter:balanced vs civilian:balanced | 16.60 | 58.83 | 28.49 | 0.66% |
| fighter:balanced vs fighter:balanced | -10.42 | 13.58 | 7.72 | 2.86% |
| elite:balanced vs fighter:balanced | 2.37 | 32.04 | 16.18 | 1.60% |
| legendary:balanced vs civilian:balanced | 50.99 | 118.25 | 46.13 | 0.66% |

## Recommendations

- Keep schema validation enabled in public resolution; its isolated median cost is reported rather than removed.
- Treat tracing overhead results as audit-emission overhead because canonical mechanical audit calculations remain enabled for replay integrity.
- Use the same seeded cohorts when comparing future tuning profiles so performance and outcome changes are attributable.
