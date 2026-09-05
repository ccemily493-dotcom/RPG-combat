# Session Performance — v0.3

Node v24.19.0; 40 measured runs after 5 warmups.

| Case | Median total (ms) | p95 total (ms) | Median/turn (ms) | Turns/s | Heap delta (bytes) |
|---|---:|---:|---:|---:|---:|
| v0.2 single-hit turn | 4.339 | 5.034 | 4.339 | 230.5 | 1697880 |
| v0.2 empty-turn control | 1.989 | 2.609 | 1.989 | 502.7 | 2387752 |
| 5-turn session, no strategy | 24.231 | 26.152 | 4.846 | 206.3 | 19600384 |
| 5-turn linear Strategy DAG | 25.458 | 27.026 | 5.092 | 196.4 | 9141808 |
| branching Strategy DAG | 10.834 | 15.835 | 5.417 | 184.6 | 230912 |
| multiple simultaneous strategies | 5.262 | 6.077 | 5.262 | 190.0 | 1874912 |
| 20-turn session | 93.222 | 99.125 | 4.661 | 214.5 | 111720 |
| persistent modifiers | 18.688 | 21.117 | 6.229 | 160.5 | 29855184 |
| delayed effects | 12.302 | 14.637 | 6.151 | 162.6 | -33208248 |
| 5-turn Strategy DAG with trace | 25.294 | 27.752 | 5.059 | 197.7 | 10224360 |

## Measured overhead

- Scheduler + temporal state: 2.857 ms/turn (143.6%).
- Strategy DAG over no-strategy session: 0.245 ms/turn (5.1%).
- Strategy trace: -0.033 ms/turn (-0.6%).

Heap deltas are coarse samples of the managed heap, not retained-memory measurements; garbage collection may make them negative.

