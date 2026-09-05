import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyPenetrationToFilter,
  canonicalHash,
  compareBatchEquivalence,
  cooldownAvailable,
  evaluatePredicate,
  lint,
  microVariance,
  planMultiAttack,
  receivedNormalPower,
  resolveModifiers,
  stableStringify,
  TurnTransaction,
  validateStrategyDag,
  validateTemporalReferences
} from "../src/index.js";
import { clone, loadFixture, loadScenarioFixture, loadSessionScenarioFixture } from "./helpers.js";

const { engine, fixture } = await loadFixture();
const { scenarios } = await loadScenarioFixture();
const { scenarios: sessionScenarios } = await loadSessionScenarioFixture();
const invariantSpec = engine.config.specs["invariants.yaml"].invariants;
const sourceFiles = ["config.js", "schema.js", "lint.js", "immutable.js", "modifiers.js", "variance.js", "transaction.js", "multi.js", "combat.js", "turn.js", "status.js", "balance.js", "replay.js", "temporal.js", "strategy.js", "session.js", "index.js"];
const source = (await Promise.all(sourceFiles.map((file) => readFile(join(engine.config.specDir, "src", file), "utf8")))).join("\n");

function resolve() {
  return engine.resolveEncounter(clone(fixture));
}

function sessionStepInput(scenario, snapshot, step, id = "invariant") {
  return { id, snapshot, declarations: step.declarations, registries: scenario.registries, seed: step.seed, trace: true };
}

const checks = {
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
    assert.equal(parser.parser_result_schema.mechanical_authority, false);
    assert.ok(parser.llm_fallback.forbidden_outputs.includes("damage"));
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
    assert.equal(first["D.reposition"], "PENDING");
    assert.equal(first["D.attack"], "PENDING");
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
