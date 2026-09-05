# Ability Parser v0.4 Performance

Generated 2026-09-05T12:57:53.810Z. Timings include schema/reference validation where compilation performs it.

| Benchmark | Iterations | Median ms | p95 ms | Ops/s |
|---|---:|---:|---:|---:|
| simple_compile | 100 | 0.2318 | 0.4319 | 3608 |
| composite_compile | 100 | 0.2107 | 0.3622 | 4211 |
| parameterized_compile | 100 | 0.2045 | 0.4386 | 4174 |
| strategy_compile | 100 | 0.2764 | 0.4976 | 3265 |
| cached_compile | 1000 | 0.0447 | 0.0839 | 18671 |
| registry_100 | 3 | 24.8689 | 27.1196 | 39 |
| registry_1000 | 1 | 264.1925 | 264.1925 | 4 |
| simple_use | 1000 | 0.1695 | 0.3109 | 5085 |
| multi_hit_use | 1000 | 0.1173 | 0.3647 | 6050 |
| multi_target_use | 1000 | 0.1027 | 0.1412 | 9101 |
| composite_use | 1000 | 0.1765 | 0.2716 | 5192 |
| strategy_fragment_use | 1000 | 0.1871 | 0.3951 | 4354 |

Approximate heap delta while exercising 100/1,000-entry registries: 24.60 MiB. This is a coarse process-level observation, not a retained-heap measurement.
