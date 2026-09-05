# Semantic Input v0.5 Performance

Generated 2026-09-05T14:02:28.743Z. All timings are local and deterministic; no network or live LLM is involved.

| Benchmark | Iterations | Median ms | p95 ms | Ops/s |
|---|---:|---:|---:|---:|
| simple_attack | 500 | 0.1640 | 0.2963 | 4879 |
| movement | 500 | 0.2144 | 0.3132 | 4267 |
| ability_alias | 500 | 0.2986 | 0.4261 | 3085 |
| sequence | 500 | 0.4250 | 0.5407 | 2248 |
| strategy | 500 | 1.3640 | 1.8045 | 698 |
| warm_context_cache | 1000 | 0.0878 | 0.1261 | 10544 |
| warm_phrase_cache_new_context | 250 | 0.1961 | 0.2986 | 4575 |
| fallback_boundary_validation | 250 | 0.1603 | 0.2960 | 5438 |
| dictionary_compile_100 | 1 | 2.5772 | 2.5772 | 388 |
| dictionary_compile_1000 | 1 | 25.0729 | 25.0729 | 40 |
| dictionary_compile_10000 | 1 | 256.2511 | 256.2511 | 4 |
| dictionary_compile_50000 | 1 | 1306.2064 | 1306.2064 | 1 |
| dictionary_lookup_50000 | 1000 | 0.0147 | 0.0184 | 64158 |

Approximate process heap delta for a retained 50,000-entry dictionary: 84.83 MiB. This is a coarse observation, not a retained-heap profile.
