# v0.3 Expanded Calibration Benchmark

- Specialized fixtures: 48
- Seeded statistical encounters: 21,440
- Resolution throughput (trace suppressed): 1145 encounters/second
- Median resolution time: 0.7987 ms
- P95 resolution time: 1.1114 ms
- Median trace-emission overhead: 0.0000 ms
- Median isolated schema-validation overhead: 0.0241 ms (3.02% of median full resolution)

## Neutral controls

| Matchup | Mean margin | Mean damage | Mean stability | Mean defense |
|---|---:|---:|---:|---:|
| civilian:balanced vs civilian:balanced | 0.01 | 13.64 | 10.11 | 15.80% |
| fighter:balanced vs civilian:balanced | 26.99 | 50.48 | 27.10 | 14.03% |
| fighter:balanced vs fighter:balanced | -0.02 | 17.50 | 9.84 | 23.75% |
| elite:balanced vs fighter:balanced | 15.98 | 38.39 | 21.43 | 22.82% |
| legendary:balanced vs civilian:balanced | 69.99 | 84.41 | 37.69 | 14.02% |

## Recommendations

- Keep schema validation enabled in public resolution; its isolated median cost is reported rather than removed.
- Treat tracing overhead results as audit-emission overhead because canonical mechanical audit calculations remain enabled for replay integrity.
- Use the same seeded cohorts when comparing future tuning profiles so performance and outcome changes are attributable.
