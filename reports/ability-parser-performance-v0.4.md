# Ability Parser v0.4 Performance

Generated 2026-09-05T13:59:22.664Z. Timings include schema/reference validation where compilation performs it.

| Benchmark | Iterations | Median ms | p95 ms | Ops/s |
|---|---:|---:|---:|---:|
| simple_compile | 100 | 0.2343 | 0.5184 | 3666 |
| composite_compile | 100 | 0.2246 | 0.4740 | 3782 |
| parameterized_compile | 100 | 0.2114 | 0.4609 | 3944 |
| strategy_compile | 100 | 0.3175 | 0.7728 | 2581 |
| cached_compile | 1000 | 0.0445 | 0.0816 | 18699 |
| registry_100 | 3 | 27.1126 | 27.3485 | 37 |
| registry_1000 | 1 | 305.0001 | 305.0001 | 3 |
| simple_use | 1000 | 0.1384 | 0.4319 | 5264 |
| multi_hit_use | 1000 | 0.1128 | 0.1904 | 7961 |
| multi_target_use | 1000 | 0.1048 | 0.1684 | 8534 |
| composite_use | 1000 | 0.1799 | 0.2842 | 5051 |
| strategy_fragment_use | 1000 | 0.1826 | 0.3203 | 4779 |

Approximate heap delta while exercising 100/1,000-entry registries: 6.39 MiB. This is a coarse process-level observation, not a retained-heap measurement.
