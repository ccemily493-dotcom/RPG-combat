# Universal RPG Engine v0.2 — Combat-Loop Scenario Results

- Scenarios: 12
- Committed: 11
- Expected pre-commit aborts: 1

| Scenario | Contract | Outcome | Modes | Represented hits | Applied reactions | Conflicts |
|---|---|---|---|---:|---:|---|
| A | one attacker, one defender, one hit | committed | individual | 1 | 1 | none |
| B | five individually resolved hits | committed | individual | 5 | 0 | none |
| C | 500-hit batch-safe action | committed | batch | 500 | 0 | none |
| D | one action with explicit multi-target allocation | committed | individual | 6 | 0 | none |
| E | two simultaneous reciprocal attacks | committed | individual | 2 | 0 | none |
| F | attack with defensive reaction | committed | individual | 1 | 1 | none |
| G | multi-hit action with limited reaction capacity | committed | individual | 5 | 2 | none |
| H | explicit reaction interruption | committed | n/a | 0 | 1 | none |
| I | simultaneous repeated status applications | committed | individual | 2 | 0 | none |
| J | conflicting displacement assignments | committed | n/a | 0 | 0 | GEOMETRY_ASSIGNMENT_CONFLICT |
| K | insufficient resources for declared quantity | aborted | n/a | 0 | 0 | none |
| L | status-heavy volley falling back to individual resolution | committed | individual | 30 | 0 | none |

## Batch equivalence (Scenario C)

- Classification valid: true
- Damage divergence: 0.0130%
- Stability divergence: 0.0181%
- Resource divergence: 0
- Hit-count divergence: 0
- Status-count divergence: 0
- Target allocation equal: true
