# Universal Programmable RPG Simulation Engine — Open Decisions through v0.3

This file records choices that can be postponed without changing the architecture. The YAML and JSON files are executable design inputs; this file is the tuning and evolution queue.

## Locked for v0.1

- The core owns deterministic mechanical resolution and has no dependency on universe modules, the Ability Parser, dictionaries, or LLM clients.
- The dependency direction is `Universe Extension → Ability Parser → RPG Engine`.
- The universal stat scale is 0–100. Values beyond the scale use universe-owned, namespaced multipliers rather than expanding the core scale.
- Offense is a vector of independent properties, not a single score. Strategy is a DAG of mechanical sub-actions, not a single score.
- The only random component is reproducible micro-variance in the inclusive factor range 0.99–1.01.
- The canonical previous-turn schema lives at `world-state.schema.json#/$defs/previousTurnState`; a fourteenth output file is intentionally not introduced.

## Provisional decisions to validate through playtests

1. **Category bands and overlap.** The six ranges overlap intentionally. Validate whether defaults create enough separation while still allowing domain specialists to cross labels. First tuning evidence: distributions of resolved stats across representative rosters.
2. **Formula calibration.** Stat weights, accuracy margin bands, response windows, damage channel coefficients, and defense multipliers are placeholders. Store them in versioned tuning profiles so balance changes do not require engine-code changes.
3. **Units.** v0.1 assumes SI-compatible distance and seconds, while power and stability use abstract effect units. Decide whether the first implementation will enforce SI internally or accept a registered unit system normalized by the parser.
4. **Critical outcomes.** No separate critical-hit mechanic is specified. A high accuracy margin currently yields full nominal exposure only. Add critical effects later only as explicit action/status rules, never as a large random event.
5. **Speed and kinetic power.** Speed determines defense timing, not power. A universe extension may derive kinetic power from mass and velocity before creating the normalized attack. Decide whether a generic optional physics adapter belongs beside the Ability Parser.
6. **Anatomy.** The generic humanoid zones are fallbacks. Non-humanoid characters must declare their zones. Decide whether zone adjacency, severability, and organ graphs should become an optional core module.
7. **Immunity.** Ordinary resistance is capped below 100%. True immunity requires an explicit rule or status. Validate whether immunity should be a first-class core predicate or remain a registered extension modifier.
8. **Batch resolution fidelity.** The threshold, batch size, and largest-remainder aggregation need equivalence tests against individual resolution. If status-heavy volleys diverge materially, force those attacks back to individual resolution.
9. **Simultaneous conflicts.** Outcomes are computed from one snapshot and committed together. A deterministic action-id order is used only for the audit stream. Specify merge rules for mutually exclusive geometry claims before implementing multiplayer concurrency.
10. **Parser thresholds.** The rule acceptance and LLM fallback thresholds are initial defaults. Collect labeled parse data by locale and tune without permitting the LLM to decide mechanics.
11. **Dictionary governance.** Namespace and priority rules are defined, but signing, distribution, trust levels, and compatibility policy for third-party universe dictionaries remain deployment concerns.
12. **State persistence.** Canonical hashes are required, but the hash algorithm and event-log storage format are not selected. Favor a widely available cryptographic hash and canonical JSON encoding.
13. **Schema identifiers.** The `$id` values use `example.invalid`. Replace them with stable project-owned URIs before publishing packages.
14. **Death and lasting injury.** Health reaching zero defaults to knockout; death, dismemberment, and persistent wounds are intentionally outside the universal core until a cross-universe contract is justified.
15. **Recovery and turn cadence.** Regeneration, rest, and cooldown progression need a universal scheduler proposal. They can initially be expressed as start/end-of-turn modifiers and events.

## Values added during the executable vertical slice

- `attack.yaml` now defines target evasion as a tunable weighted combination of movement, reaction, and coordination. The original accuracy formula consumed `target_evasion` without defining how to derive it.
- `attack.yaml` now provides tunable inverse-square and stepped area-falloff parameters. The original taxonomy named these falloffs but did not supply executable parameters.
- `damage.yaml` now provides a tunable base status-resistance threshold. The original formula referenced `base_threshold` without declaring it.
- `damage.yaml` now makes v0.1 immunity an explicit active-status-tag predicate (`immunity:<channel>`), keeping resistance below 100% distinct from true immunity.
- The implementation preserves an exact post-penetration 100% active-defense result instead of allowing a sub-1.00 micro-variance factor to lower it. This resolves the conflict between the defense pipeline's variance step and the explicit invariant that 100% effective defense filters all filterable damage; non-boundary defense values still receive variance.

## Implementation sequence

1. Build schema/config loaders and a linter that enforces tunable-number annotations, finite values, normalized weights, references, and extension namespaces.
2. Implement immutable snapshots, modifier selection/ordering, canonical traces, and seeded micro-variance.
3. Implement action transactions, geometry hooks, accuracy and timing filters, defense, penetration, damage, and secondary consequences.
4. Implement strategy DAG scheduling and the previous-turn event interface.
5. Implement the separate rule-first Ability Parser, then add the schema-constrained LLM fallback behind the confidence gate.
6. Add golden replays, property tests from `invariants.yaml`, and balance fixtures before creating universe extensions.

## v0.1 exit criteria

- All YAML parses and all JSON Schemas pass Draft 2020-12 meta-validation.
- A reference encounter can be replayed byte-for-byte from a snapshot and seed.
- Every invariant has an automated test or a documented static enforcement point.
- At least one attack covers a miss, graze, partial hit, solid hit, penetration interaction, zone vulnerability, stability loss, and status resistance.
- Individual and batched resolution conserve the declared quantities in the configured tolerance.
- Removing or disabling the LLM produces the same mechanical result for an already normalized action.

## v0.1.1 calibration findings awaiting human judgment

- **Same-category accuracy scaling:** balanced equal-category margins decline from about -5 at Civilian to -19 at Legendary because physical accuracy weights sum to 0.80 while evasion weights sum to 1.00. Decide whether higher tiers should become progressively harder to hit at parity.
- **Defense composition:** current multiplication averages 5.52% active filtering across specialized defender cohorts; experimental weighted and grouped models average about 27.35% and 16.59%. Choose desired defensive outcomes before replacing any formula.
- **Damage targets:** Fighter vs Civilian remains about 58.8 average damage, and the extreme-gap specialized cohort averages about 125.7. Define acceptable damage bands by category gap and profile before editing coefficients.
- **Variance shape:** uniform remains canonical. Centered triangular and bounded normal-like distributions reduce near-threshold flips while preserving the same 0.99–1.01 bounds. Select the intended interpretation of unmodeled variation.
- **Balance expectations:** decide which profile/gap expectations, if any, should later become soft regression warnings. None have been promoted to hard engine invariants.

## Decisions promoted in v0.2

- Opposed physical accuracy and evasion weight totals are normalized independently. This removes category-level drift caused only by unequal coefficient sums while preserving stat specialization, modifiers, and contextual effects.
- Weighted defense composition is canonical. Feasibility, nonzero compatibility and coverage, and cost availability remain explicit gates; execution, timing, compatibility, and coverage retain separate trace contributions; stability remains a bounded multiplier.
- Damage gap expectations are configurable, structured warnings and never hard invariants.
- Sub-100 harm capacity uses a monotonic bounded, piecewise-linear vulnerability curve capped at 1.35 instead of reciprocal amplification.
- Centered triangular micro-variance is canonical on the inclusive 0.99–1.01 interval. Uniform and bounded normal-like distributions remain available for experiments.
- Stable action ID is only the final ordering/conflict tie-breaker. It is not a combat-stat input.
- Mutually exclusive displacement assignments use highest explicit priority followed by stable action ID and emit a structured conflict. Additive displacement remains commutative.
- Reaction capacity is state/configuration data, not a hardcoded one-reaction rule. Reaction coverage is explicit per hit, subset, action, area, or time window.
- Status merge behavior is owned by the validated status-definition registry, never inferred from a status name or an action's prose.

## v0.2 ambiguities resolved with conservative tunable defaults

- The individual/batch threshold and batch group size remain configuration values. Batching is disabled automatically for unaggregated per-hit statuses, hit-by-hit reaction consumption, hit-specific interruption, heterogeneous attacks, and other declared unsafe semantics.
- Batch equivalence tolerances are 2% relative damage, 2% relative stability, exact resource use, exact represented hit count, exact status count, and exact target allocation. Exceeding tolerance invalidates the batch-safe classification.
- Reaction-chain depth is bounded by configuration to prevent infinite execution.
- Cancelled actions still pay `on_attempt` costs but do not pay `on_contact` costs; all maximum obligations are reserved before resolution.
- Incompatible simultaneous position assignments do not silently use last-write-wins; they follow the documented conflict policy and remain visible in traces and previous-turn state.

## Remaining decisions after v0.2

1. **Extreme-gap damage expectation.** The promoted models currently produce an 85.56 average in the specialized extreme-gap cohort, below the provisional 90–150 warning band. Decide whether the band, fixture mix, or a later coefficient should change; do not retune from this result alone.
2. **Weighted-defense distribution.** Canonical specialized-cohort filtering averages 29.12%, with p05 15.78% and p95 45.38%. Confirm whether those tails match intended play before further tuning.
3. **Batch approximation policy.** Decide whether future status registries may declare statistically aggregated attempts, and which status semantics are safe to approximate.
4. **Interruption timing richness.** v0.2 supports explicit cancel, delay, execution reduction, target alteration, concentration break, and reaction consumption, but does not model a continuous event clock.
5. **Geometry conflict policy.** Priority-plus-ID is deliberately minimal. A later spatial milestone may introduce occupancy, collision, or vector-resolution contracts without changing atomic turn semantics.
6. **Status replacement conflicts.** Registry priority and stable source ordering are deterministic; authoring guidance is still needed for cross-extension status families.
7. **Resource timing.** `on_attempt`, `on_contact`, per-target, and per-second costs are normalized, but later scheduler work must specify cross-turn reservations and cooldown progression.
8. **Public schema identifiers.** The schemas still use `example.invalid`; choose project-owned stable URIs before publishing.
9. **Persistent event storage.** Complete turns have canonical hashes and replay information, but no durable event-log format or networking contract is selected.
10. **Next milestone.** Do not begin it automatically. A sensible candidate is a v0.2.1 combat-loop hardening pass focused on randomized model-based turn generation, longer multi-turn replay chains, and registry authoring tools—still without an Ability Parser or universe extension.

## Decisions promoted for v0.3

- The extreme-gap damage warning range is 80–150. The observed specialized mean of 85.56 is accepted and remains a non-blocking balance diagnostic.
- Weighted defense remains canonical and accepted for v0.3. The observed p05 near the poor/weak boundary does not authorize a coefficient change.
- Accuracy thresholds remain unchanged. Small randomness is intentional; modeled state, positioning, actions, specialization, and modifiers should create diversity.
- Fighter-versus-Civilian damage near 50.45 is accepted provisionally. No focused coefficient study or tuning change is authorized from that matchup alone.
- Stateful status batching remains conservative. A status-heavy volley falls back to individual resolution unless its normalized registry definition later declares safe aggregate semantics.

## Conservative deterministic defaults introduced in v0.3

- Session phases are `TURN_START → PRE_ACTION → ACTION_RESOLUTION → POST_ACTION → TURN_END`. Scheduled activation, cooldown progression, capacity recovery, explicit recovery hooks, combat delegation, consequence application, duration progression, bounded history, and termination occur in the order declared by `temporal.yaml`.
- Cooldowns begin on successful use, use `TURN` units in v0.3, progress at `TURN_START`, and are unavailable while remaining duration is above zero.
- Newly created `TURN` duration state does not decrement during its creation turn. `PHASE` state progresses after its named phase; `ACTION` and `REACTION_WINDOW` state progresses by the number of normalized resolution events; conditional and triggered state expires only when its predicate/trigger is satisfied.
- One newly eligible dependency layer executes per session step. Newly unlocked nodes wait for the next step. This is a tunable scheduler rule, not an assumption about narrative time.
- Strategy nodes and simultaneous strategies are ordered by strategy ID then node ID for scheduling/audit. Those IDs are tie-breakers, never mechanical stats.
- Primitive opposed contests use primitive-specific weighted terms. A negative margin fails, 0–10 is partial, and partial currently satisfies `ON_SUCCESS` dependencies. These are provisional rule coefficients, not a universal strategy score.
- When all nodes are terminal and the strategy was not cancelled, the provisional overall state is `SUCCEEDED` if at least one node succeeded, otherwise `FAILED`. Branch mechanics and node outcomes remain fully visible.
- Action-backed strategy nodes call `resolveTurn` with unchanged normalized action inputs. Strategy orchestration adds no hidden bonus.
- Action/reaction capacities restore to their declared capacity at `TURN_START`; resource and stability recovery are zero unless explicit bounded recovery hooks exist in state.
- Mechanical history retains at most five turns by default, contains normalized events only, and uses canonical turn/event ordering.
- Prepared opportunities use explicit `ON_ATTEMPT`, `ON_USE`, `ON_SUCCESS`, `ON_TRIGGER`, or `NEVER` consumption. `ON_SUCCESS` reaction opportunities are retained if the generated reaction does not apply.

## Remaining decisions after v0.3

1. **Primitive contest targets.** FEINT, DISTRACTION, and AMBUSH have distinct provisional stat weights and 0/10 margin bands. Playtest data is needed before changing weights or deciding whether partial outcomes should satisfy `ON_SUCCESS` dependencies.
2. **Session phase granularity.** Five phases are sufficient for deterministic v0.3 scheduling. A continuous event clock or additional phases should be added only if normalized mechanics cannot be expressed with explicit timing/dependencies.
3. **DAG layer cadence.** One dependency layer per session step is deliberately conservative. Future playtests must decide whether some zero-time state/condition nodes may unlock within the same step without introducing incidental ordering.
4. **Overall strategy completion.** The provisional any-success-after-all-terminal rule supports fallback branches, but authored strategies may later need explicit success-node declarations or a formal completion predicate.
5. **Opportunity reservation timing.** Counter templates currently reserve their reaction/resource costs when triggered through `resolveTurn`, not when prepared. A future normalized reservation mode may be needed for mechanics that lock resources across turns.
6. **Relational geometry richness.** BLIND_SPOT and FLANKING are validated relational conditions with ordinary modifier bindings; facing arcs, occupancy, pathfinding, and full line-of-effect simulation remain outside the core.
7. **History depth.** Five turns is a provisional bounded default. Real strategy fixtures should determine whether mechanical predicates need a larger configured window.
8. **Schema identifiers.** Schemas still use `example.invalid`; select stable project-owned URIs before publishing.
9. **Durable replay storage.** Session hashes and golden replay data are canonical, but a durable event-log transport/storage format is not selected.
10. **Next milestone.** Do not begin automatically. A sensible candidate is v0.3.1 hardening: model-based random DAG generation, authored-registry ergonomics, and longer stress replays—still without natural-language parsing, an Ability Parser, LLM dependencies, or universe extensions.
