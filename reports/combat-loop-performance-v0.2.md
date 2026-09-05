# Universal RPG Engine v0.2 — Combat-Loop Performance

| Case | Iterations | Median ms | P95 ms | Turns/s | Trace overhead ms | Approx heap delta/turn |
|---|---:|---:|---:|---:|---:|---:|
| single_hit | 200 | 4.2125 | 5.7923 | 226.2 | 0.0000 | -33322 B |
| five_hit | 100 | 8.1004 | 9.5670 | 120.9 | 0.0000 | -27488 B |
| ten_hit | 75 | 13.6513 | 14.9003 | 73.4 | 0.3274 | 193870 B |
| multi_target | 100 | 9.6189 | 11.3165 | 101.6 | 0.7059 | 58666 B |
| simultaneous_two_actor | 100 | 4.9577 | 6.4135 | 193.6 | 0.0372 | -177623 B |
| batch_100 | 50 | 10.4342 | 12.9776 | 93.2 | 0.0000 | -243324 B |
| batch_500 | 20 | 37.8601 | 41.2726 | 26.3 | 2.0291 | 1081 B |
| individual_100 | 10 | 111.9701 | 116.2900 | 8.9 | 0.0000 | -3193623 B |
| individual_500 | 3 | 533.7821 | 539.8694 | 1.9 | 0.0000 | 7342920 B |

- Schema-validation median: 0.0187 ms; p95: 0.0274 ms.
- 100-hit batch median speedup: 10.73×.
- 500-hit batch median speedup: 14.10×.
- Heap deltas are sampled without forcing garbage collection; negative or noisy values reflect normal runtime collection and are not retained-memory measurements.
