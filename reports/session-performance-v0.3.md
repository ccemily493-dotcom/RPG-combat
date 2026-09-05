# Session Performance — v0.3

Node v24.19.0; 40 measured runs after 5 warmups.

| Case | Median total (ms) | p95 total (ms) | Median/turn (ms) | Turns/s | Heap delta (bytes) |
|---|---:|---:|---:|---:|---:|
| v0.2 single-hit turn | 5.188 | 6.913 | 5.188 | 192.8 | 3252384 |
| v0.2 empty-turn control | 2.279 | 3.055 | 2.279 | 438.8 | 2650024 |
| 5-turn session, no strategy | 15.543 | 17.788 | 3.109 | 321.7 | 7965688 |
| 5-turn linear Strategy DAG | 19.061 | 23.494 | 3.812 | 262.3 | 13545320 |
| branching Strategy DAG | 9.007 | 10.406 | 4.504 | 222.0 | 20210752 |
| multiple simultaneous strategies | 5.040 | 8.082 | 5.040 | 198.4 | 13733672 |
| 20-turn session | 61.857 | 69.151 | 3.093 | 323.3 | 12449568 |
| persistent modifiers | 19.849 | 20.978 | 6.616 | 151.1 | -13490928 |
| delayed effects | 12.180 | 14.426 | 6.090 | 164.2 | 33104096 |
| 5-turn Strategy DAG with trace | 17.409 | 20.543 | 3.482 | 287.2 | -50823880 |

## Measured overhead

- Scheduler + temporal state: 0.830 ms/turn (36.4%).
- Strategy DAG over no-strategy session: 0.704 ms/turn (22.6%).
- Strategy trace: -0.330 ms/turn (-8.7%).

Heap deltas are coarse samples of the managed heap, not retained-memory measurements; garbage collection may make them negative.

