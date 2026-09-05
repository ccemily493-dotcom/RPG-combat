# Extension SDK v0.7 Performance

| Benchmark | Iterations | Median ms | p95 ms | Ops/s |
|---|---:|---:|---:|---:|
| extension_package_cold_compile | 20 | 6.7812 | 10.2469 | 137 |
| ability_instantiation | 1000 | 0.1625 | 0.3749 | 5079 |
| domain_conflict | 2000 | 0.0115 | 0.0159 | 78271 |

No network, LLM, universe-specific core branch, or executable extension script was used.
