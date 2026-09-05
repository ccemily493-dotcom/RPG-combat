# Universal RPG Engine v0.2 — Combat-Loop Performance

| Case | Iterations | Median ms | P95 ms | Turns/s | Trace overhead ms | Approx heap delta/turn |
|---|---:|---:|---:|---:|---:|---:|
| single_hit | 200 | 4.6169 | 6.3218 | 211.6 | 0.0000 | 22032 B |
| five_hit | 100 | 7.9891 | 9.3258 | 124.1 | 0.0000 | -115294 B |
| ten_hit | 75 | 14.0589 | 17.6121 | 68.9 | 0.7425 | 62187 B |
| multi_target | 100 | 9.8155 | 11.7144 | 99.9 | 0.9179 | 100736 B |
| simultaneous_two_actor | 100 | 4.7006 | 6.0823 | 204.8 | 0.0000 | -114000 B |
| batch_100 | 50 | 10.0874 | 12.3261 | 95.3 | 0.4729 | 476367 B |
| batch_500 | 20 | 48.5231 | 75.4000 | 19.0 | 0.0000 | 1276900 B |
| individual_100 | 10 | 117.2679 | 145.1730 | 8.2 | 0.0000 | -171738 B |
| individual_500 | 3 | 548.5340 | 573.9272 | 1.8 | 52.9256 | 8601163 B |

- Schema-validation median: 0.0196 ms; p95: 0.0343 ms.
- 100-hit batch median speedup: 11.63×.
- 500-hit batch median speedup: 11.30×.
- Heap deltas are sampled without forcing garbage collection; negative or noisy values reflect normal runtime collection and are not retained-memory measurements.
