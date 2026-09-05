# v0.2 Legacy Neutral Simulation Report

- Encounters: 5,000
- Runtime: 4044.62 ms
- Throughput: 1236 encounters/second
- Invariant violations: 0

| Matchup | Miss | Graze | Partial | Solid | Avg damage | Avg stability | Avg defense |
|---|---:|---:|---:|---:|---:|---:|---:|
| civilian vs civilian | 0.0% | 48.9% | 51.1% | 0.0% | 13.60 | 10.08 | 15.80% |
| fighter vs civilian | 0.0% | 0.0% | 0.0% | 100.0% | 50.48 | 27.11 | 14.02% |
| fighter vs fighter | 0.0% | 50.1% | 49.9% | 0.0% | 17.59 | 9.90 | 23.74% |
| elite vs fighter | 0.0% | 0.0% | 100.0% | 0.0% | 38.39 | 21.44 | 22.82% |
| legendary vs civilian | 0.0% | 0.0% | 0.0% | 100.0% | 84.39 | 37.69 | 14.03% |

## Suspicious distributions

- fighter vs civilian: all attacks occupy one accuracy band; expected with ±1% variance, but balance is threshold-sensitive.
- fighter vs civilian: average active defense filters under the provisional 15% diagnostic floor; inspect the weighted components and gates.
- elite vs fighter: all attacks occupy one accuracy band; expected with ±1% variance, but balance is threshold-sensitive.
- legendary vs civilian: all attacks occupy one accuracy band; expected with ±1% variance, but balance is threshold-sensitive.
- legendary vs civilian: average active defense filters under the provisional 15% diagnostic floor; inspect the weighted components and gates.

## Harness assumptions

- Benchmark characters intentionally use their category default for every stat as neutral baselines; this is not a character-generation rule.
- Every target declares the same generic block defense and every attack is a normalized kinetic projectile.
- Only micro-variance changes between iterations; no tactical AI or action-selection randomness is present.
