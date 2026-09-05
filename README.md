# Universal RPG Engine v0.3

This package resolves deterministic, universe-agnostic encounters, simultaneous turns, and multi-turn combat sessions from normalized structured data. v0.3 adds temporal phases, durations, cooldowns, delayed effects, bounded mechanical history, persistent modifiers, relational state, conditional opportunities, and acyclic Strategy DAG orchestration while preserving the v0.1 `resolveEncounter` and v0.2 `resolveTurn` APIs.

It contains no universe extension, Ability Parser, natural-language parser, strategy-language interpreter, universe dictionary, tactical AI, networking layer, or LLM dependency.

## Requirements and commands

Node.js 22 or newer is required.

```bash
npm install
npm run check
```

- `npm run validate` parses/lints 12 canonical YAML files, compiles 10 Draft 2020-12 JSON Schemas, and validates registries, profiles, 12 combat scenarios, and 14 temporal/strategy scenarios.
- `npm test` runs all hard invariants plus unit, property, architecture, transaction, calibration, combat-loop, temporal, Strategy DAG, batching, and replay tests.
- `npm run replay` verifies the encounter, multi-action turn, and five-turn Strategy DAG golden replays.
- `npm run scenarios` and `npm run session:scenarios` regenerate normalized v0.2 combat and v0.3 session fixtures.
- `npm run combat:scenarios` and `npm run session:report` write machine-readable/Markdown scenario diagnostics.
- `npm run combat:benchmark` and `npm run session:benchmark` benchmark turn and session resolution.
- `npm run profiles` regenerates all 48 within-category specialized benchmark profiles.
- `npm run calibrate` runs the expanded deterministic cohorts and writes v0.3 accuracy, defense-composition, damage, harm-capacity, micro-variance, performance, and non-blocking balance-warning reports.
- `npm run sweep` executes configured one- and two-dimensional parameter sweeps and writes JSON and CSV outputs.
- `npm run calibration:check` regenerates profiles, calibration reports, and parameter sweeps without silently changing canonical coefficients.

Experimental formulas and sweep candidates live under `experiments/`. Canonical combat does not select them automatically. Tuning overrides are accepted only for values explicitly marked tunable and produce a new immutable configuration.

## Session API

```js
import { createDefaultEngine } from "./src/index.js";

const engine = await createDefaultEngine();
const step = engine.resolveSessionStep({
  id: "session:turn-4",
  snapshot: currentSnapshot,
  declarations: { actions, reactions },
  registries,
  termination_predicates: [],
  seed: "replayable-session-seed:4",
  trace: true
});
```

`resolveSessionStep` processes temporal activation/recovery, Strategy DAG eligibility, ordinary `resolveTurn`, post-action consequences, expiration/history, and configured termination. It returns a new immutable snapshot, turn result, temporal events, strategy progress, replay metadata, and optional trace. `resolveSession` accepts an initial snapshot plus normalized steps; `replaySession` verifies byte-identical multi-turn resolution.

Strategy nodes do not receive a plan score or hidden bonus. Action-backed nodes are passed to `resolveTurn`; opposed primitives use their own declared inputs; condition nodes use declarative predicates; state-setup nodes only emit normalized effects.

## Turn and encounter compatibility

```js
const turnResult = engine.resolveTurn({ id: "turn:4", world, characters, actions, reactions, registries, seed: "turn-seed", trace: true });

const encounterResult = engine.resolveEncounter({
  world,
  actor,
  target,
  action,
  registries,
  seed: "replayable-encounter-seed",
  trace: true
});
```

`resolveEncounter` remains available for v0.1 clients. Migrating to `resolveTurn` requires a character map keyed by character ID, an `actions` array, an optional `reactions` array, explicit cost modes and target allocation for ambiguous multi-target actions, and schema-valid defense/status registries.

All APIs validate, clone, and freeze inputs before resolution. `resolveTurn` remains authoritative for simultaneous combat, reservations, reactions, multi-hit/batch resolution, merge, and atomic commit. Tracing is optional and cannot influence mechanics.

## Validation classes

Hard invariants fail tests/builds: replay determinism, bounded defense/variance/durations/history, valid acyclic DAGs and references, dependency/failure-policy enforcement, cooldown and opportunity correctness, resource/reaction conservation, atomicity, schema validity, batching equivalence, and direct/strategy mechanical equivalence.

Balance and strategy diagnostics remain non-blocking. They never assign a universal strategy-quality score or retune canonical values.

## Architecture boundary

`src/` imports only Node.js standard-library modules plus `yaml` and `ajv`. A future parser may emit validated actions and Strategy DAGs; the engine never calls into a parser, LLM, or universe extension.
