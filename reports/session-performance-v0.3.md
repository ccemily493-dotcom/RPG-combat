# Session Performance — v0.3

Node v24.19.0; 40 measured runs after 5 warmups.

| Case | Median total (ms) | p95 total (ms) | Median/turn (ms) | Turns/s | Heap delta (bytes) |
|---|---:|---:|---:|---:|---:|
| v0.2 single-hit turn | 5.434 | 8.496 | 5.434 | 184.0 | -12539520 |
| v0.2 empty-turn control | 2.195 | 2.969 | 2.195 | 455.6 | -12815136 |
| 5-turn session, no strategy | 15.563 | 16.847 | 3.113 | 321.3 | -3299952 |
| 5-turn linear Strategy DAG | 17.893 | 20.676 | 3.579 | 279.4 | 21078512 |
| branching Strategy DAG | 7.768 | 8.694 | 3.884 | 257.5 | 24682248 |
| multiple simultaneous strategies | 3.842 | 4.762 | 3.842 | 260.3 | 15238424 |
| 20-turn session | 61.197 | 69.110 | 3.060 | 326.8 | 7815528 |
| persistent modifiers | 20.425 | 24.489 | 6.808 | 146.9 | -6053928 |
| delayed effects | 12.397 | 14.689 | 6.198 | 161.3 | 37922512 |
| 5-turn Strategy DAG with trace | 17.813 | 22.296 | 3.563 | 280.7 | 29803912 |

## Measured overhead

- Scheduler + temporal state: 0.918 ms/turn (41.8%).
- Strategy DAG over no-strategy session: 0.466 ms/turn (15.0%).
- Strategy trace: -0.016 ms/turn (-0.4%).

Heap deltas are coarse samples of the managed heap, not retained-memory measurements; garbage collection may make them negative.

