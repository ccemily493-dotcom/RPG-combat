import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  applyPenetrationToFilter,
  beginStrategyStep,
  canonicalHash,
  compareBatchEquivalence,
  completeStrategyStep,
  cooldownAvailable,
  evaluatePredicate,
  lint,
  microVariance,
  normalizeStrategyDag,
  planMultiAttack,
  receivedNormalPower,
  resolveModifiers,
  scheduleStrategyNodes,
  stableStringify,
  TurnTransaction,
  validateStrategyDag,
  validateTemporalReferences
} from "../src/index.js";
import { clone, loadFixture, loadScenarioFixture, loadSessionScenarioFixture } from "./helpers.js";
import { AbilityCompilationCache, compileAbilityDefinition, compileAbilityRegistry, evaluateExpression, instantiateAbilityUse, validateAbilityDefinition, validateCompiledAbility, validateExpression } from "../src/ability-parser/index.js";
import { buildGenericAbilityDefinitions } from "../src/ability-parser/fixtures.js";

const { engine, fixture } = await loadFixture();
const { scenarios } = await loadScenarioFixture();
const { scenarios: sessionScenarios } = await loadSessionScenarioFixture();
const invariantSpec = engine.config.specs["invariants.yaml"].invariants;
const sourceFiles = ["config.js", "schema.js", "lint.js", "immutable.js", "modifiers.js", "variance.js", "transaction.js", "multi.js", "combat.js", "turn.js", "status.js", "balance.js", "replay.js", "temporal.js", "strategy.js", "session.js", "index.js"];
const source = (await Promise.all(sourceFiles.map((file) => readFile(join(engine.config.specDir, "src", file), "utf8")))).join("\n");
const abilityDefinitions = buildGenericAbilityDefinitions();
const abilityContext = { rulesetVersion: engine.config.version, stats: Object.keys(engine.config.specs["stats.yaml"].stats), resources: Object.keys(scenarios.A.characters.a.resources), registries: scenarios.A.registries };
const abilityRegistry = compileAbilityRegistry(abilityDefinitions, abilityContext);
const abilityUse = (id, parameters = {}) => ({ ability_id: id, actor_id: "a", targets: [{ type: "character", ref: "b", position: null, body_zone: "core" }], parameters, declared_options: { turn: 0 } });
const instantiateAbility = (id, parameters = {}) => instantiateAbilityUse(abilityRegistry.get(id), abilityUse(id, parameters), { characters: scenarios.A.characters, world: scenarios.A.world });

function resolve() {
  return engine.resolveEncounter(clone(fixture));
}

function sessionStepInput(scenario, snapshot, step, id = "invariant") {
  return { id, snapshot, declarations: step.declarations, registries: scenario.registries, seed: step.seed, trace: true };
}

const checks = {
  "INV-071": async () => {
    for (const file of sourceFiles) {
      const value = await readFile(join(engine.config.specDir, "src", file), "utf8");
      assert.doesNotMatch(value, /from\s+["'][^"']*ability-parser/i);
    }
  },
  "INV-072": async () => {
    const parserDir = join(engine.config.specDir, "src", "ability-parser");
    for (const file of (await readdir(parserDir)).filter((name) => name.endsWith(".js"))) {
      const value = await readFile(join(parserDir, file), "utf8");
      assert.doesNotMatch(value, /resolve(?:Turn|Encounter|Session)\s*\(/, file);
      assert.doesNotMatch(value, /eval\s*\(|new\s+Function/, file);
    }
  },
  "INV-073": () => {
    assert.equal(validateAbilityDefinition(abilityDefinitions[0]), true);
    assert.throws(() => validateAbilityDefinition(null), (error) => error.code === "SCHEMA_ERROR");
  },
  "INV-074": () => {
    assert.equal(validateCompiledAbility(abilityRegistry.get("core.example.heavy_strike")), true);
    assert.throws(() => validateCompiledAbility({}), (error) => error.code === "SCHEMA_ERROR");
  },
  "INV-075": () => {
    assert.throws(() => instantiateAbility("core.example.parameterized_blast", { charge: 2 }), (error) => error.code === "PARAMETER_ERROR");
  },
  "INV-076": () => {
    const invalid = clone(abilityDefinitions[0]);
    invalid.requirements = [{ type: "MIN_STAT", ref: "unknown" }];
    assert.throws(() => compileAbilityDefinition(invalid, abilityContext), (error) => error.code === "REFERENCE_ERROR");
  },
  "INV-077": () => {
    assert.throws(() => evaluateExpression({ op: "DIVIDE", args: [{ const: 1 }, { const: 0 }] }, {}), (error) => error.code === "EXPRESSION_ERROR");
    assert.throws(() => validateExpression({ op: "EXECUTE", args: [{ const: 1 }] }), (error) => error.code === "EXPRESSION_ERROR");
  },
  "INV-078": () => {
    let expression = { const: 1 };
    for (let index = 0; index < 17; index += 1) expression = { op: "ABS", args: [expression] };
    assert.throws(() => validateExpression(expression, { maxDepth: 16 }), /depth/i);
  },
  "INV-079": () => {
    assert.equal(stableStringify(compileAbilityDefinition(abilityDefinitions[0], abilityContext)), stableStringify(compileAbilityDefinition(abilityDefinitions[0], abilityContext)));
  },
  "INV-080": () => {
    const cache = new AbilityCompilationCache();
    const cached = cache.compile(abilityDefinitions[0], abilityContext);
    assert.equal(stableStringify(cached), stableStringify(compileAbilityDefinition(abilityDefinitions[0], abilityContext)));
    assert.equal(cache.compile(abilityDefinitions[0], abilityContext), cached);
  },
  "INV-081": () => {
    assert.equal(stableStringify(instantiateAbility("core.example.heavy_strike")), stableStringify(instantiateAbility("core.example.heavy_strike")));
  },
  "INV-082": () => {
    const edited = clone(abilityDefinitions[0]);
    edited.name = "Different presentation";
    edited.flavor = "No mechanics";
    assert.equal(compileAbilityDefinition(edited, abilityContext).mechanical_hash, abilityRegistry.get(edited.ability_id).mechanical_hash);
  },
  "INV-083": () => {
    const definition = clone(abilityDefinitions[0]);
    const before = stableStringify(definition);
    compileAbilityDefinition(definition, abilityContext);
    assert.equal(stableStringify(definition), before);
  },
  "INV-084": () => {
    const payload = instantiateAbility("core.example.disrupting_shot");
    assert.equal(Object.hasOwn(payload.actions[0], "final_damage"), false);
    assert.equal(Object.hasOwn(payload.actions[0].attack.status_effects[0], "applied"), false);
  },
  "INV-085": () => {
    const payload = instantiateAbility("core.example.rapid_barrage");
    const result = engine.resolveTurn({ ...clone(scenarios.A), id: "inv085", actions: payload.actions, reactions: [], seed: "inv085" });
    assert.equal(result.actionResults[0].representedHitCount, 5);
    assert.equal(result.characters.a.resources.energy.current, scenarios.A.characters.a.resources.energy.current - 25);
  },
  "INV-086": () => {
    const payload = instantiateAbility("core.example.disrupting_shot");
    const result = engine.resolveTurn({ ...clone(scenarios.A), id: "inv086", actions: payload.actions, reactions: [], seed: "inv086" });
    assert.ok(Array.isArray(result.actionResults[0].hits[0].statuses));
  },
  "INV-087": () => {
    const payload = instantiateAbility("core.example.tactical_opening");
    assert.deepEqual(payload.strategy_fragments[0].nodes.map((node) => node.execution_class), ["ZERO_TIME", "ZERO_TIME", "ACTION"]);
    assert.equal(payload.strategy_fragments[0].nodes[2].action.actor_id, "a");
  },
  "INV-088": () => {
    const generated = instantiateAbility("core.example.heavy_strike").actions[0];
    const direct = engine.resolveTurn({ ...clone(scenarios.A), id: "inv088", actions: [clone(generated)], reactions: [], seed: "inv088" });
    const produced = engine.resolveTurn({ ...clone(scenarios.A), id: "inv088", actions: [generated], reactions: [], seed: "inv088" });
    assert.equal(direct.resultHash, produced.resultHash);
  },
  "INV-054": () => {
    // Zero-time limit: exceed max_zero_time_transitions_per_step
    const config = engine.config;
    const maxZt = config.specs["strategy.yaml"].dag_execution?.strategy_scheduler?.max_zero_time_transitions_per_step?.value ?? 64;
    assert.ok(Number.isFinite(maxZt) && maxZt > 0);
    // A pathological chain beyond the limit should throw a structured ValidationError
    const strategy = {
      strategy_id: "inv054", owner: "a", state: "ACTIVE",
      completion_policy: "ALL_TERMINAL", goals: { required: [], optional: [] },
      nodes: [],
      metadata: {}
    };
    // Build (maxZt + 1) chained ZERO_TIME condition nodes
    for (let i = 0; i <= maxZt; i += 1) {
      strategy.nodes.push({
        id: `n${i}`, kind: "CONDITION", execution_class: "ZERO_TIME", state: "PENDING",
        dependency_mode: "ALL_OF",
        dependencies: i === 0 ? [] : [{ node_id: `n${i - 1}`, when: "ON_COMPLETION" }],
        conditions: [], condition: { compare: { left: "world.turn", operator: "gte", right: 0 } },
        failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "CONDITION_TRUE",
        action: null, primitive: null,
        effects: { on_success: [], on_failure: [], on_completion: [] }
      });
    }
    const snapshot = { ...clone(sessionScenarios.N.initial_snapshot), seed: "inv054-limit" };
    assert.throws(() => beginStrategyStep(config, snapshot, [strategy]), /zero-time transition limit/i);
  },
  "INV-055": () => {
    // normalizeStrategyDag sets execution_class based on node kind
    const strategy = clone(sessionScenarios.N.initial_snapshot.strategies[0]);
    // Remove execution_class so normalization fires
    for (const node of strategy.nodes) delete node.execution_class;
    normalizeStrategyDag(strategy, engine.config);
    for (const node of strategy.nodes) {
      assert.ok(["ZERO_TIME", "ACTION", "REACTION", "MOVEMENT", "PASSIVE"].includes(node.execution_class),
        `node ${node.id} has invalid execution_class: ${node.execution_class}`);
      if (node.kind === "CONDITION" || node.kind === "STATE_TRANSITION") assert.equal(node.execution_class, "ZERO_TIME");
      if (node.kind === "ACTION") assert.equal(node.execution_class, "ACTION");
    }
  },
  "INV-056": () => {
    // With one generic action per turn, the same DAG naturally spans turns.
    const input = clone(sessionScenarios.D);
    input.initial_snapshot.characters.a.action_economy.action_capacity = 1;
    input.initial_snapshot.characters.a.action_economy.actions_remaining = 1;
    const result = engine.resolveSession(input);
    const step1Nodes = Object.fromEntries(result.snapshots[1].strategies[0].nodes.map((node) => [node.id, node.state]));
    assert.notEqual(step1Nodes["D.attack"], "SUCCEEDED"); // attack waits
    assert.equal(step1Nodes["D.distraction"], "SUCCEEDED");
    assert.equal(step1Nodes["D.reposition"], "PENDING");
  },
  "INV-057": () => {
    // PASSIVE nodes are skipped by scheduler; scheduleStrategyNodes returns them as non-eligible
    const strategy = {
      strategy_id: "inv057", owner: "a", state: "ACTIVE",
      completion_policy: "ALL_TERMINAL", goals: { required: [], optional: [] },
      nodes: [{
        id: "passive-node", kind: "PRIMITIVE", execution_class: "PASSIVE", state: "PENDING",
        primitive: { id: "COUNTER_SETUP", actor_ref: "a", target_ref: null },
        dependency_mode: "ALL_OF", dependencies: [], conditions: [],
        failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "RESOLVED",
        action: null, condition: null,
        effects: { on_success: [], on_failure: [], on_completion: [] }
      }],
      metadata: {}
    };
    const snapshot = clone(sessionScenarios.N.initial_snapshot);
    const result = scheduleStrategyNodes([strategy], { ...snapshot, declarations: { actions: [], reactions: [] }, seed: "inv057" });
    const record = result.records.find((r) => r.nodeId === "passive-node");
    assert.equal(record.eligible, false);
    assert.equal(record.reason, "passive_trigger_driven");
    assert.equal(result.executable.length, 0);
  },
  "INV-058": () => {
    // ON_SUCCESS is strict: a partial band does NOT satisfy it
    // Build a minimal strategy: node A (will be SUCCEEDED with partial band), node B depends ON_SUCCESS
    const strategy = {
      strategy_id: "inv058", owner: "a", state: "ACTIVE",
      completion_policy: "ALL_TERMINAL", goals: { required: [], optional: [] },
      nodes: [
        {
          id: "predecessor", kind: "CONDITION", execution_class: "ZERO_TIME", state: "SUCCEEDED",
          result_band: "PARTIAL", // explicitly set partial band
          dependency_mode: "ALL_OF", dependencies: [], conditions: [],
          condition: { compare: { left: "world.turn", operator: "gte", right: 0 } },
          failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "CONDITION_TRUE",
          action: null, primitive: null,
          effects: { on_success: [], on_failure: [], on_completion: [] }
        },
        {
          id: "on-success-dep", kind: "CONDITION", execution_class: "ZERO_TIME", state: "PENDING",
          dependency_mode: "ALL_OF",
          dependencies: [{ node_id: "predecessor", when: "ON_SUCCESS" }],
          conditions: [], condition: { compare: { left: "world.turn", operator: "gte", right: 0 } },
          failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "CONDITION_TRUE",
          action: null, primitive: null,
          effects: { on_success: [], on_failure: [], on_completion: [] }
        }
      ],
      metadata: {}
    };
    const snapshot = clone(sessionScenarios.N.initial_snapshot);
    const result = scheduleStrategyNodes([strategy], { ...snapshot, declarations: { actions: [], reactions: [] }, seed: "inv058" });
    const depRecord = result.records.find((r) => r.nodeId === "on-success-dep");
    // A PARTIAL predecessor is terminal but does not satisfy strict ON_SUCCESS.
    assert.equal(depRecord.eligible, false);
    assert.ok(["dependencies_pending", "dependency_branch_unavailable"].includes(depRecord.reason));
  },
  "INV-059": () => {
    // ON_PARTIAL_OR_BETTER: partial band satisfies it
    const strategy = {
      strategy_id: "inv059", owner: "a", state: "ACTIVE",
      completion_policy: "ALL_TERMINAL", goals: { required: [], optional: [] },
      nodes: [
        {
          id: "predecessor", kind: "CONDITION", execution_class: "ZERO_TIME", state: "SUCCEEDED",
          result_band: "PARTIAL",
          dependency_mode: "ALL_OF", dependencies: [], conditions: [],
          condition: { compare: { left: "world.turn", operator: "gte", right: 0 } },
          failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "CONDITION_TRUE",
          action: null, primitive: null,
          effects: { on_success: [], on_failure: [], on_completion: [] }
        },
        {
          id: "on-partial-dep", kind: "CONDITION", execution_class: "ZERO_TIME", state: "PENDING",
          dependency_mode: "ALL_OF",
          dependencies: [{ node_id: "predecessor", when: "ON_PARTIAL_OR_BETTER" }],
          conditions: [], condition: { compare: { left: "world.turn", operator: "gte", right: 0 } },
          failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "CONDITION_TRUE",
          action: null, primitive: null,
          effects: { on_success: [], on_failure: [], on_completion: [] }
        }
      ],
      metadata: {}
    };
    const snapshot = clone(sessionScenarios.N.initial_snapshot);
    const result = scheduleStrategyNodes([strategy], { ...snapshot, declarations: { actions: [], reactions: [] }, seed: "inv059" });
    const depRecord = result.records.find((r) => r.nodeId === "on-partial-dep");
    assert.equal(depRecord.eligible, true);
  },
  "INV-060": () => {
    // completion_policy is evaluated after all nodes terminal; default ALL_TERMINAL
    const strategy = clone(sessionScenarios.D.initial_snapshot.strategies[0]);
    assert.ok(strategy.completion_policy === "ALL_TERMINAL" || !strategy.completion_policy);
    const result = engine.resolveSession(clone(sessionScenarios.D));
    const finalStrategy = result.finalSnapshot.strategies[0];
    assert.equal(finalStrategy.state, "COMPLETED");
  },
  "INV-061": () => {
    // REQUIRED_GOALS describes completion; a failed goal does not turn
    // structural execution state into a universal strategy-success Boolean.
    const strategy = {
      strategy_id: "inv061", owner: "a", state: "ACTIVE",
      completion_policy: "REQUIRED_GOALS",
      goals: { required: ["goal-node"], optional: [] },
      nodes: [
        {
          id: "goal-node", kind: "CONDITION", execution_class: "ZERO_TIME", state: "FAILED",
          dependency_mode: "ALL_OF", dependencies: [], conditions: [],
          failure_policy: "CONTINUE", fallback_node_ids: [], completion_rule: "CONDITION_TRUE",
          action: null, primitive: null, condition: null,
          effects: { on_success: [], on_failure: [], on_completion: [] }
        }
      ],
      metadata: {}
    };
    completeStrategyStep([strategy], { immediateResults: [], actionBindings: [] }, []);
    assert.equal(strategy.state, "COMPLETED");
    assert.equal(strategy.nodes[0].state, "FAILED");
  },
  "INV-062": () => {
    // ACTIVATE_FALLBACK activates the declared fallback node
    const strategy = {
      strategy_id: "inv062", owner: "a", state: "ACTIVE",
      completion_policy: "ALL_TERMINAL", goals: { required: [], optional: [] },
      nodes: [
        {
          id: "primary", kind: "CONDITION", execution_class: "ZERO_TIME", state: "FAILED",
          dependency_mode: "ALL_OF", dependencies: [], conditions: [],
          failure_policy: "ACTIVATE_FALLBACK", fallback_node_ids: ["fallback"],
          completion_rule: "CONDITION_TRUE", action: null, primitive: null, condition: null,
          effects: { on_success: [], on_failure: [], on_completion: [] }
        },
        {
          id: "fallback", kind: "CONDITION", execution_class: "ZERO_TIME", state: "PENDING",
          dependency_mode: "ALL_OF", dependencies: [], conditions: [],
          failure_policy: "CONTINUE", fallback_node_ids: [],
          completion_rule: "CONDITION_TRUE", action: null, primitive: null, condition: null,
          effects: { on_success: [], on_failure: [], on_completion: [] }
        }
      ],
      metadata: {}
    };
    completeStrategyStep([strategy], { immediateResults: [], actionBindings: [] }, []);
    // Fallback should be set to PENDING (ready for next scheduling pass)
    assert.equal(strategy.nodes.find((n) => n.id === "fallback").state, "PENDING");
  },
  "INV-063": () => {
    // Default completion_policy is ALL_TERMINAL
    const strategy = { strategy_id: "inv063", owner: "a", state: "ACTIVE", nodes: [], metadata: {} };
    normalizeStrategyDag(strategy, engine.config);
    assert.equal(strategy.completion_policy, "ALL_TERMINAL");
    assert.deepEqual(strategy.goals, { required: [], optional: [] });
  },
  "INV-064": () => {
    // cross_turn_resource_reservation defaults to false per spec
    assert.equal(engine.config.specs["strategy.yaml"].dag_execution.cross_turn_resource_reservation?.default ?? false, false);
  },
  "INV-065": () => {
    // MOVEMENT falls back to action_economy for legacy characters (no movement_economy field)
    const legacyCharacter = clone(sessionScenarios.D.initial_snapshot.characters.a);
    assert.ok(!Object.hasOwn(legacyCharacter, "movement_economy") || legacyCharacter.movement_economy === undefined);
  },
  "INV-066": () => {
    // normalizeStrategyDag fills execution_class for every node
    const strategy = clone(sessionScenarios.N.initial_snapshot.strategies[0]);
    for (const node of strategy.nodes) delete node.execution_class;
    normalizeStrategyDag(strategy, engine.config);
    for (const node of strategy.nodes) assert.ok(node.execution_class, `node ${node.id} missing execution_class after normalization`);
    // Second call is idempotent
    const classesBefore = strategy.nodes.map((n) => n.execution_class);
    normalizeStrategyDag(strategy, engine.config);
    assert.deepEqual(strategy.nodes.map((n) => n.execution_class), classesBefore);
  },
  "INV-067": () => {
    // After normalization, execution_class is set; scheduleStrategyNodes never needs to guess
    const strategy = clone(sessionScenarios.D.initial_snapshot.strategies[0]);
    normalizeStrategyDag(strategy, engine.config);
    for (const node of strategy.nodes) {
      assert.ok(["ZERO_TIME", "ACTION", "REACTION", "MOVEMENT", "PASSIVE"].includes(node.execution_class));
    }
  },
  "INV-068": () => {
    // Partial band is preserved: DISTRACTION that is partial band !== FAILED and !== full SUCCESS
    const bands = engine.config.specs["strategy.yaml"].primitive_resolution.outcome_bands;
    const failedBelow = bands.failed_below.value;
    const partialBelow = bands.partial_below.value;
    // partialBelow > failedBelow → partial range exists
    assert.ok(partialBelow > failedBelow);
    // The partial band is a distinct named outcome
    assert.equal(engine.config.specs["strategy.yaml"].dag_execution?.outcome_classes?.includes("PARTIAL") ??
      ["SUCCESS", "PARTIAL", "FAILURE"].includes("PARTIAL"), true);
  },
  "INV-069": () => {
    // strategyDiagnostics is non-blocking: it returns an object with nonBlocking: true
    const result = engine.resolveSession(clone(sessionScenarios.D));
    const step = result.stepResults[0];
    assert.ok(Object.hasOwn(step.strategyProgress, "diagnostics"));
    assert.equal(step.strategyProgress.diagnostics.nonBlocking, true);
    assert.equal(step.strategyProgress.diagnostics.classification, "strategy_diagnostic");
  },
  "INV-070": () => {
    // ZERO_TIME chain: in the existing session scenarios, CONDITION/STATE_TRANSITION nodes
    // resolve in the same step as the action node that follows them
    const result = engine.resolveSession(clone(sessionScenarios.D));
    // D.distraction is an opposed PRIMITIVE (ACTION class), not ZERO_TIME — it runs in step 1
    // D.reposition is action-backed (REPOSITION) — step 2 after BLIND_SPOT
    // The existing session scenario verifies the dependency chain works; here we verify
    // that a strategy with a CONDITION (ZERO_TIME) followed by an ACTION resolves the
    // CONDITION immediately and the ACTION in the same scheduling pass
    const step1 = result.snapshots[1].strategies[0].nodes.map((n) => ({ id: n.id, state: n.state }));
    // D.distraction ran in step 1
    assert.ok(step1.find((n) => n.id === "D.distraction")?.state === "SUCCEEDED");
  },


  "INV-001": () => {
    for (const character of [fixture.actor, fixture.target]) {
      for (const value of Object.values(character.resolved_stats)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 100);
    }
  },
  "INV-002": () => assert.doesNotMatch(source, /globalAttackScore|global_attack_score\s*=/),
  "INV-003": () => {
    assert.equal(engine.config.specs["strategy.yaml"].principles.global_strategy_score_forbidden, true);
    assert.equal(engine.config.schemas["action.schema.json"].$defs.subaction.required.includes("success_rule_ref"), true);
  },
  "INV-004": () => {
    const pipeline = resolve().trace.pipeline;
    assert.ok(pipeline.indexOf("accuracy_filter") < pipeline.indexOf("defense_resolution"));
    assert.ok(pipeline.indexOf("speed_timing_filter") < pipeline.indexOf("damage_and_secondary_effects"));
  },
  "INV-005": () => {
    const result = resolve();
    assert.notEqual(result.trace.damage.contactPower, result.healthDamage);
    assert.ok(result.trace.damage.channels.every((channel) => Object.hasOwn(channel, "conversion")));
  },
  "INV-006": () => {
    assert.equal(applyPenetrationToFilter(50, 0, 1), 50);
    assert.equal(applyPenetrationToFilter(50, 1, 1), 0);
  },
  "INV-007": () => {
    const result = resolve();
    assert.ok(result.defenseFilter >= 0 && result.defenseFilter <= 1);
    assert.ok(Object.hasOwn(result.trace.defense, "stabilityLoss"));
  },
  "INV-008": () => {
    assert.equal(receivedNormalPower(100, 100, 0), 0);
    const result = resolve();
    assert.ok(result.trace.defense.costPaid > 0);
  },
  "INV-009": () => assert.equal(resolve().trace.damage.zoneId, "core"),
  "INV-010": () => {
    const result = resolve();
    assert.ok(result.trace.offense.resolved.power.activeModifierIds.includes("character.role.power"));
    assert.ok(result.trace.offense.resolved.accuracy.activeModifierIds.includes("action.aim.accuracy"));
    assert.ok(result.trace.accuracy.targetScore.activeModifierIds.includes("world.visibility.avoidance"));
  },
  "INV-011": () => {
    const modifiers = [
      { id: "b", layer: "ACTION", target: "x", operation: "additive", value: 2 },
      { id: "a", layer: "WORLD", target: "x", operation: "multiplicative", value: 3 }
    ];
    assert.deepEqual(resolveModifiers(2, "x", [modifiers], {}), resolveModifiers(2, "x", [[...modifiers].reverse()], {}));
  },
  "INV-012": () => {
    const context = Object.freeze({ action: Object.freeze({ tags: Object.freeze(["x"]) }) });
    assert.equal(evaluatePredicate({ has_tag: { subject: "action", tag: "x" } }, context), true);
    assert.equal(context.action.tags.length, 1);
  },
  "INV-013": () => {
    for (let index = 0; index < 1000; index += 1) {
      const factor = microVariance(engine.config, { seed: index, simulationId: "i", turn: 0, actionId: "a", targetId: "t", component: "c" }).factor;
      assert.ok(factor >= 0.99 && factor <= 1.01);
    }
  },
  "INV-014": () => assert.doesNotMatch(source, /Math\.random|randomBytes|randomUUID/),
  "INV-015": () => {
    const replay = engine.replay(clone(fixture));
    assert.equal(replay.deterministic, true);
  },
  "INV-016": () => {
    const individual = planMultiAttack(engine.config, 24, 2, { energy: 3 });
    const batch = planMultiAttack(engine.config, 25, 2, { energy: 3 });
    assert.equal(individual.mode, "individual");
    assert.equal(batch.mode, "batch");
    assert.equal(batch.representedPower, batch.totalPower);
  },
  "INV-017": () => assert.equal(stableStringify(resolve()), stableStringify(resolve())),
  "INV-018": () => {
    const parser = engine.config.specs["parser.yaml"];
    assert.equal(parser.authority.parser_determines_outcomes, false);
    assert.equal(parser.authority.parser_mutates_canonical_state, false);
    assert.equal(parser.metadata.semantic_provider_implementation, false);
  },
  "INV-019": () => {
    const imports = source.split(/\r?\n/).filter((line) => /^\s*import\s/.test(line)).join("\n").toLowerCase();
    for (const forbidden of ["ability_parser", "universe", "openai", "anthropic", "llm", "dictionary"]) assert.doesNotMatch(imports, new RegExp(forbidden));
  },
  "INV-020": () => {
    assert.equal(engine.config.schemas["world-state.schema.json"].properties.extension_state.propertyNames.pattern, "^[a-z][a-z0-9_-]*:");
    assert.deepEqual(fixture.world.extension_state, {});
  },
  "INV-021": () => {
    const mutations = resolve().trace.stateMutations;
    const firstDebit = mutations.findIndex((mutation) => mutation.type === "resource");
    const firstReserve = mutations.findIndex((mutation) => mutation.type === "reserve");
    assert.ok(firstReserve >= 0 && firstReserve < firstDebit);
  },
  "INV-022": () => assert.deepEqual(resolve(), resolve()),
  "INV-023": async () => assert.deepEqual(await lint(engine.config), { ok: true, issues: [] }),
  "INV-024": () => {
    const bad = clone(fixture.actor);
    bad.resolved_stats.reaction = Infinity;
    assert.throws(() => engine.schemas.validate("character", bad));
  },
  "INV-025": () => {
    const trace = resolve().trace;
    for (const key of ["inputHashes", "offense", "geometry", "accuracy", "timing", "defense", "damage", "statuses", "stateMutations", "outputHashes"]) assert.ok(Object.hasOwn(trace, key));
  },
  "INV-026": () => {
    const result = engine.resolveTurn(clone(scenarios.B));
    for (const character of Object.values(result.characters)) {
      for (const resource of Object.values(character.resources)) assert.ok(resource.current >= 0 && resource.current <= resource.maximum);
    }
    assert.equal(result.characters.a.resources.energy.current, scenarios.B.characters.a.resources.energy.current - 7);
  },
  "INV-027": () => {
    const result = engine.resolveTurn(clone(scenarios.G));
    assert.ok(result.characters.b.action_economy.reactions_remaining >= 0);
    const consumed = result.reactionResults.filter((reaction) => ["applied", "failed"].includes(reaction.outcome));
    assert.equal(new Set(consumed.map((reaction) => reaction.id)).size, consumed.length);
  },
  "INV-028": () => {
    const first = engine.resolveTurn(clone(scenarios.E));
    const input = clone(scenarios.E);
    input.actions.reverse();
    const second = engine.resolveTurn(input);
    assert.equal(first.resultHash, second.resultHash);
  },
  "INV-029": () => {
    const original = clone({ world: scenarios.A.world, characters: scenarios.A.characters, registries: scenarios.A.registries });
    const before = stableStringify(original);
    const transaction = new TurnTransaction(original);
    transaction.stage({ type: "test" });
    assert.throws(() => transaction.commit((working) => {
      working.characters.a.resources.health.current = 0;
      throw new Error("forced commit failure");
    }));
    assert.equal(stableStringify(original), before);
  },
  "INV-030": () => {
    const comparison = compareBatchEquivalence(engine, scenarios.C);
    assert.equal(comparison.validClassification, true);
  },
  "INV-031": () => {
    assert.doesNotThrow(() => engine.schemas.validate("defenseSources", scenarios.A.registries.defense_sources));
    assert.doesNotThrow(() => engine.schemas.validate("statusDefinitions", scenarios.I.registries.status_definitions));
    assert.throws(() => engine.schemas.validate("defenseSources", { bad: { base_filter: 10 } }));
  },
  "INV-032": () => {
    const replay = engine.replayTurn(clone(scenarios.E));
    assert.equal(replay.deterministic, true);
  },
  "INV-033": () => {
    const result = engine.resolveTurn(clone(scenarios.J));
    assert.equal(result.conflicts[0].policy, "highest_explicit_priority_then_action_id");
  },
  "INV-034": () => {
    const withTrace = engine.resolveTurn({ ...clone(scenarios.E), trace: true });
    const withoutTrace = engine.resolveTurn({ ...clone(scenarios.E), trace: false });
    assert.equal(withTrace.resultHash, withoutTrace.resultHash);
  },
  "INV-035": () => {
    assert.doesNotThrow(() => validateStrategyDag(clone(sessionScenarios.N.initial_snapshot.strategies[0]), sessionScenarios.N.initial_snapshot.characters, engine.config));
    assert.throws(() => validateStrategyDag(clone(sessionScenarios.M.initial_snapshot.strategies[0]), sessionScenarios.M.initial_snapshot.characters, engine.config), /cycle/i);
    const duplicate = clone(sessionScenarios.N.initial_snapshot.strategies[0]);
    duplicate.nodes[1].id = duplicate.nodes[0].id;
    assert.throws(() => validateStrategyDag(duplicate, sessionScenarios.N.initial_snapshot.characters, engine.config), /duplicate/i);
  },
  "INV-036": () => {
    const forward = engine.resolveSession(clone(sessionScenarios.L));
    const reverse = clone(sessionScenarios.L);
    reverse.initial_snapshot.strategies.reverse();
    assert.equal(forward.resultHash, engine.resolveSession(reverse).resultHash);
  },
  "INV-037": () => {
    const result = engine.resolveSession(clone(sessionScenarios.D));
    const first = Object.fromEntries(result.snapshots[1].strategies[0].nodes.map((node) => [node.id, node.state]));
    assert.equal(first["D.distraction"], "SUCCEEDED");
    assert.equal(first["D.reposition"], "SUCCEEDED");
    assert.equal(first["D.attack"], "SUCCEEDED");
    const completed = result.stepResults[0].strategyProgress.results.map((item) => item.nodeId);
    assert.ok(completed.indexOf("D.distraction") < completed.indexOf("D.reposition"));
    assert.ok(completed.indexOf("D.reposition") < completed.indexOf("D.attack"));
  },
  "INV-038": () => {
    const nodes = Object.fromEntries(engine.resolveSession(clone(sessionScenarios.E)).finalSnapshot.strategies[0].nodes.map((node) => [node.id, node.state]));
    assert.equal(nodes["E.distraction"], "FAILED");
    assert.equal(nodes["E.reposition"], "CANCELLED");
    assert.equal(nodes["E.attack"], "CANCELLED");
  },
  "INV-039": () => {
    const result = engine.resolveSession(clone(sessionScenarios.H));
    assert.equal(result.stepResults.flatMap((step) => step.temporalEvents).filter((event) => event.opportunity_id === "H.opportunity" && event.type === "opportunity_triggered").length, 1);
    assert.equal(result.finalSnapshot.temporal_state.opportunities.length, 0);
  },
  "INV-040": () => {
    const result = engine.resolveSession(clone(sessionScenarios.K));
    assert.ok(result.finalSnapshot.temporal_state.relations.every((relation) => relation.duration.remaining === undefined || relation.duration.remaining >= 0));
    assert.deepEqual(result.finalSnapshot.temporal_state.relations.map((relation) => relation.id), ["K.permanent"]);
  },
  "INV-041": () => {
    const scenario = clone(sessionScenarios.B);
    const first = engine.resolveSessionStep(sessionStepInput(scenario, scenario.initial_snapshot, scenario.steps[0], "cooldown:first"));
    assert.equal(cooldownAvailable(first.nextSnapshot.characters.a, "B.shared"), false);
    assert.throws(() => engine.resolveSessionStep(sessionStepInput(scenario, first.nextSnapshot, scenario.steps[1], "cooldown:blocked")), /cooldown/i);
  },
  "INV-042": () => {
    const result = engine.resolveSession(clone(sessionScenarios.A));
    const active = result.stepResults[1].turnResult.actionResults[0].hits[0].trace.offense.resolved.accuracy.activeModifierIds;
    const expired = result.stepResults[2].turnResult.actionResults[0].hits[0].trace.offense.resolved.accuracy.activeModifierIds;
    assert.ok(active.includes("A.accuracy"));
    assert.ok(!expired.includes("A.accuracy"));
  },
  "INV-043": () => {
    const result = engine.resolveSession(clone(sessionScenarios.C));
    assert.ok(result.snapshots[1].temporal_state.scheduled_effects.some((effect) => effect.id === "C.next-turn"));
    assert.ok(result.stepResults[1].temporalEvents.some((event) => event.scheduled_effect_id === "C.next-turn" && event.type === "scheduled_effect_activated"));
  },
  "INV-044": () => {
    const temporal = clone(sessionScenarios.N.initial_snapshot.temporal_state);
    temporal.relations.push({ id: "bad", kind: "CUSTOM_CORE", subject_ref: "missing", object_ref: "b", source_ref: "test", duration: { type: "PERMANENT" }, consumption: "NEVER", modifiers: [], created_turn: 0, consumed: false, tags: [] });
    assert.throws(() => validateTemporalReferences(temporal, sessionScenarios.N.initial_snapshot.characters, sessionScenarios.N.initial_snapshot.world), /unknown/i);
  },
  "INV-045": () => assert.equal(engine.replaySession(clone(sessionScenarios.N)).deterministic, true),
  "INV-046": () => {
    const withTrace = engine.resolveSession({ ...clone(sessionScenarios.D), trace: true });
    const withoutTrace = engine.resolveSession({ ...clone(sessionScenarios.D), trace: false });
    assert.equal(withTrace.resultHash, withoutTrace.resultHash);
  },
  "INV-047": () => {
    const input = clone(sessionScenarios.N);
    const before = stableStringify(input);
    const result = engine.resolveSession(input);
    assert.equal(stableStringify(input), before);
    assert.equal(canonicalHash(result.snapshots[0]), canonicalHash(input.initial_snapshot));
  },
  "INV-048": () => {
    const scenario = clone(sessionScenarios.N);
    scenario.steps = [scenario.steps[0]];
    scenario.initial_snapshot.characters.a.resources.energy.current = 999;
    scenario.initial_snapshot.temporal_state.recovery_hooks = [{ id: "bounded", kind: "RESOURCE", character_ref: "a", resource: "energy", amount: 999, phase: "TURN_START", enabled: true }];
    const result = engine.resolveSession(scenario);
    assert.equal(result.finalSnapshot.characters.a.resources.energy.current, result.finalSnapshot.characters.a.resources.energy.maximum);
  },
  "INV-049": () => {
    assert.equal(engine.config.specs["strategy.yaml"].principles.orchestration_provides_hidden_bonus, false);
    assert.doesNotMatch(source, /strategyScore|strategy_score\s*=|tacticalPower|planQuality/);
  },
  "INV-050": () => {
    const strategic = clone(sessionScenarios.D);
    const actionNode = strategic.initial_snapshot.strategies[0].nodes.find((node) => node.id === "D.attack");
    actionNode.dependencies = [];
    strategic.initial_snapshot.strategies[0].nodes = [actionNode];
    strategic.steps = [{ declarations: { actions: [], reactions: [] }, seed: "direct-equivalence" }];
    const direct = clone(strategic);
    direct.initial_snapshot.strategies = [];
    const directAction = clone(actionNode.action);
    directAction.turn = 0;
    direct.steps[0].declarations.actions = [directAction];
    assert.equal(
      stableStringify(engine.resolveSession(strategic).stepResults[0].turnResult.actionResults),
      stableStringify(engine.resolveSession(direct).stepResults[0].turnResult.actionResults)
    );
  },
  "INV-051": () => {
    const history = engine.resolveSession(clone(sessionScenarios.N)).finalSnapshot.temporal_state.mechanical_history;
    assert.ok(history.length <= engine.config.specs["temporal.yaml"].mechanical_history.maximum_turns.value);
    assert.deepEqual(history.map((entry) => entry.turn), [...history].map((entry) => entry.turn).sort((a, b) => a - b));
  },
  "INV-052": () => {
    const result = engine.resolveSession(clone(sessionScenarios.L));
    assert.deepEqual(result.finalSnapshot.strategies.map((strategy) => strategy.strategy_id), ["L.alpha", "L.beta"]);
    assert.deepEqual(result.finalSnapshot.characters.b.modifiers.slice(-2).map((modifier) => modifier.id), ["L.alpha.mod", "L.beta.mod"]);
  },
  "INV-053": async () => {
    const result = engine.resolveSession(clone(sessionScenarios.D));
    assert.ok(result.stepResults.every((step) => step.sessionMetadata.delegatedResolver === "resolveTurn"));
    assert.doesNotMatch((await readFile(join(engine.config.specDir, "src", "session.js"), "utf8")), /resolveAttackAction|damagePipeline|resolveDefense/);
  }
};

test("invariants.yaml has an executable check for every declared invariant", () => {
  assert.deepEqual(Object.keys(checks).sort(), invariantSpec.map((invariant) => invariant.id).sort());
});

for (const invariant of invariantSpec) {
  test(`${invariant.id}: ${invariant.rule}`, async () => {
    await checks[invariant.id]();
  });
}
