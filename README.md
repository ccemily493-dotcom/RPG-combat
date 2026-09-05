# Universal RPG Engine v0.7

This package resolves deterministic, universe-agnostic encounters, simultaneous turns, and multi-turn combat sessions. v0.7 adds a declarative Extension SDK, a bounded JJK reference extension, advanced extension-owned conflict/condition contracts, and the Asura campaign-validation fixture on top of the v0.5 rule-first Semantic Input layer.

The JJK reference package is data outside the engine core. The core contains no franchise resource, domain, vow, summon, character branch, live LLM client, tactical AI, networking layer, or semantic outcome authority. Dependency direction is `Extension → Semantic/Ability compilation → RPG Engine`; it never reverses.

## Requirements and commands

Node.js 22 or newer is required.

```bash
npm install
npm run check
```

- `npm run validate` parses/lints 12 engine YAML files plus `semantic.yaml`, compiles 10 engine, 3 Ability Parser, and 3 Semantic Input Draft 2020-12 JSON Schemas, and validates registries, profiles, scenarios, generic abilities, locale dictionaries, and a semantic probe.
- `npm test` runs all hard invariants plus unit, property, architecture, transaction, calibration, combat-loop, temporal, Strategy DAG, batching, and replay tests.
- `npm run replay` verifies the encounter, multi-action turn, and five-turn Strategy DAG golden replays.
- `npm run ability:replay` verifies compiled-ability, ability-use, combat, and multi-turn ability-session goldens.
- `npm run ability:report` and `npm run ability:benchmark` produce non-blocking parser diagnostics and compilation/instantiation benchmarks.
- `npm run semantic:fixtures` regenerates deterministic Spanish/English semantic scenarios.
- `npm run semantic:replay` verifies basic, strategy, ability, fallback-boundary, and multi-turn semantic goldens.
- `npm run semantic:report` and `npm run semantic:benchmark` produce non-blocking confidence/coverage diagnostics and rule/cache/dictionary performance measurements.
- `npm run extension:replay` verifies the compiled extension, JJK ability use, and 20-turn Asura engine-session goldens.
- `npm run extension:check` audits dependency direction/core leakage and writes extension diagnostics and performance reports.
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

Dependencies do not imply turn progression. `ZERO_TIME` nodes chain in the same step, while `ACTION`, `REACTION`, and `MOVEMENT` nodes proceed only when their matching economy permits. Strategy execution state (`COMPLETED`) remains separate from required/optional goal outcomes.

## Ability Parser API

```js
import { compileAbilityRegistry, instantiateAbilityUse } from "./src/ability-parser/index.js";

const registry = compileAbilityRegistry(abilityDefinitions, compatibilityContext);
const normalized = instantiateAbilityUse(registry.get("core.example.heavy_strike"), {
  ability_id: "core.example.heavy_strike",
  actor_id: "a",
  targets: [{ type: "character", ref: "b", position: null, body_zone: "core" }],
  parameters: {},
  declared_options: { turn: 4 }
}, { characters, world });

const result = engine.resolveTurn({ world, characters, actions: normalized.actions, reactions: normalized.reactions, registries, seed });
```

Compilation validates namespaced/versioned definitions, registry references, parameters, variants, cooldown/cost contracts, and a bounded declarative expression AST. Instantiation binds actors, targets, parameters, and context without resolving hit, defense, damage, status application, or final state. Static compiled artifacts are immutable and cacheable by definition/parser/ruleset/registry hashes.

## Semantic Input API

```js
import {
  compileSemanticDictionary,
  parseSemanticInput,
  compileSemanticIntent
} from "./src/semantic-input/index.js";

const dictionary = compileSemanticDictionary(entries, { locale: "es" });
const parsed = await parseSemanticInput("uso Heavy Strike contra B", {
  dictionary,
  config: semanticConfig,
  locale: "es",
  context: { actorId: "a", entities, abilityRegistry, world, characters }
});

if (parsed.status === "RESOLVED") {
  const normalized = compileSemanticIntent(parsed.intent, {
    abilityRegistry, actionTemplates, world, characters
  });
}
```

The parser normalizes Unicode and punctuation while retaining source spans; applies explicit session/extension/character/ability/locale precedence; resolves only unambiguous entities; returns field-level confidence; and uses phrase/context caches keyed by dictionary, registry, parser, and context hashes. Mechanical templates are caller-supplied or come from compiled abilities—words such as “punch” never manufacture power, accuracy, damage, or success.

The optional `SemanticFallbackProvider` is an interface only. v0.5 includes a deterministic mock for tests, performs no network calls, and never auto-promotes learned candidates into canonical vocabulary.

## Extension SDK API

```js
import { loadExtensionPackage } from "./src/extension-sdk/index.js";

const extension = await loadExtensionPackage("./extensions/jjk-reference", {
  rulesetVersion: "0.3",
  stats: Object.keys(engine.config.specs["stats.yaml"].stats),
  resources: ["health", "stability", "energy"]
});
```

The loader validates the manifest, orders dependencies, rejects cycles/collisions, composes immutable namespaced registries, compiles ability definitions and bilingual semantic dictionaries, and returns separate mechanical/provenance hashes. It reads JSON/YAML only and executes no extension script. Multi-property conflicts and binding contracts return comparisons or normalized consequence attempts—never hit, damage, status, or final-state outcomes.

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

Authority flows strictly as `player text → Semantic Input → Ability Parser/normalized contract → RPG Engine → result`. Core engine modules import neither Ability Parser nor Semantic Input. Ability Parser imports no Semantic Input. Semantic Input may call the public Ability Parser only in its final binder and never invokes `resolveEncounter`, `resolveTurn`, or `resolveSession`. A future provider may only propose untrusted `SemanticIntent` data; it can never supply damage, hit, defense, status, resource, strategy-success, or state outcomes.
