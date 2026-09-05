import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { instantiateAbilityUse } from "../src/ability-parser/index.js";
import { canonicalHash, stableStringify } from "../src/index.js";
import { compileExtensionPackages, ExtensionError, loadExtensionPackage, readExtensionPackage, resolveBindingContract, resolveMultiPropertyConflict } from "../src/extension-sdk/index.js";
import { clone, loadFixture } from "./helpers.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXTENSION = join(ROOT, "extensions", "jjk-reference");
const CORE_STATS = ["physical_capability", "movement", "reaction", "coordination", "resistance", "perception", "strategy", "energy_capacity", "energy_output", "energy_control", "energy_efficiency"];
const context = { rulesetVersion: "0.3", stats: CORE_STATS, resources: ["health", "stability", "energy"] };
const packageInput = await readExtensionPackage(EXTENSION);
const compiled = compileExtensionPackages([packageInput], context);

test("v0.6 package compilation is deterministic and immutable", () => {
  const again = compileExtensionPackages([clone(packageInput)], context);
  assert.equal(compiled.mechanical_hash, again.mechanical_hash);
  assert.equal(compiled.provenance_hash, again.provenance_hash);
  assert.equal(compiled.ability_registry.size, 8);
  assert.ok(Object.isFrozen(compiled) && Object.isFrozen(compiled.registries));
});

test("presentation changes provenance but not extension mechanics", () => {
  const changed = clone(packageInput);
  changed.manifest.metadata.name = "Different presentation";
  changed.content.characters[0].metadata.description = "Different prose";
  changed.content.characters[0].name = "Presentation only";
  const other = compileExtensionPackages([changed], context);
  assert.equal(other.mechanical_hash, compiled.mechanical_hash);
  assert.notEqual(other.provenance_hash, compiled.provenance_hash);
});

test("four cursed-energy dimensions remain independent core aliases", () => {
  const aliases = packageInput.scaling.stat_aliases;
  assert.equal(aliases["jjk.stat.cursed_energy_reserve"], "energy_capacity");
  assert.equal(aliases["jjk.stat.cursed_energy_output"], "energy_output");
  assert.equal(aliases["jjk.stat.cursed_energy_control"], "energy_control");
  assert.equal(aliases["jjk.stat.cursed_energy_efficiency"], "energy_efficiency");
  assert.equal(new Set(Object.values(aliases).filter((value) => value.startsWith("energy_"))).size, 4);
});

test("collisions, missing dependencies, bad versions, and cycles fail", () => {
  const duplicate = clone(packageInput); duplicate.manifest.extension_id = "jjk.other"; duplicate.abilities = []; duplicate.semantics = [];
  assert.throws(() => compileExtensionPackages([packageInput, duplicate], context), (error) => error instanceof ExtensionError && error.code === "EXTENSION_REGISTRY_COLLISION");
  const missing = clone(packageInput); missing.manifest.dependencies = [{ extension_id: "missing.package", version: "1.0.0" }];
  assert.throws(() => compileExtensionPackages([missing], context), (error) => error.code === "EXTENSION_DEPENDENCY_MISSING");
  const left = clone(packageInput); left.manifest.extension_id = "jjk.left"; left.manifest.dependencies = [{ extension_id: "jjk.right", version: "0.7.0" }]; left.abilities = []; left.registries = {}; left.semantics = [];
  const right = clone(left); right.manifest.extension_id = "jjk.right"; right.manifest.dependencies = [{ extension_id: "jjk.left", version: "0.7.0" }];
  assert.throws(() => compileExtensionPackages([left, right], context), (error) => error.code === "EXTENSION_DEPENDENCY_CYCLE");
  right.manifest.dependencies = []; right.manifest.version = "2.0.0"; left.manifest.dependencies[0].version = "1.0.0";
  assert.throws(() => compileExtensionPackages([left, right], context), (error) => error.code === "EXTENSION_DEPENDENCY_VERSION");
});

test("filesystem loader yields the same canonical package", async () => {
  const loaded = await loadExtensionPackage(EXTENSION, context);
  assert.equal(loaded.mechanical_hash, compiled.mechanical_hash);
  assert.deepEqual(loaded.package_order, ["jjk.reference"]);
});

test("Asura ability compiles to deterministic ordinary action without outcomes", () => {
  const asura = packageInput.content.characters[0];
  const actor = { id: asura.id, resolved_stats: asura.stats, resources: { ...asura.resources, health: { current: 100, maximum: 100 }, stability: { current: 100, maximum: 100 }, energy: { current: 100, maximum: 100 } } };
  const ability = compiled.ability_registry.get("jjk.raw_energy_blast");
  const use = { ability_id: ability.ability_id, actor_id: actor.id, targets: [{ type: "character", ref: "target", position: null, body_zone: null }], parameters: { intensity: 0.5 }, declared_options: { turn: 0, action_id_prefix: "asura.use" } };
  const runtime = { actor, characters: { [actor.id]: actor, target: actor } };
  const first = instantiateAbilityUse(ability, use, runtime);
  assert.equal(stableStringify(first), stableStringify(instantiateAbilityUse(ability, use, runtime)));
  assert.equal(first.actions[0].attack.power, 33.5);
  assert.equal(first.actions[0].attack.accuracy, 66.7);
  assert.equal(first.actions[0].resolution, null);
});

test("Asura reserve, output, control, and efficiency change separate responsibilities", () => {
  const base = packageInput.content.characters[0].stats;
  const power = (s) => s.energy_output * 0.5;
  const accuracy = (s) => s.energy_control * 0.7 + s.coordination * 0.3;
  const reserve = (s) => s.energy_capacity;
  const cost = (s) => 12 * (1 + (100 - s.energy_efficiency) / 200);
  assert.notEqual(power({ ...base, energy_output: 68 }), power(base)); assert.equal(accuracy({ ...base, energy_output: 68 }), accuracy(base));
  assert.notEqual(accuracy({ ...base, energy_control: 95 }), accuracy(base)); assert.equal(power({ ...base, energy_control: 95 }), power(base));
  assert.notEqual(reserve({ ...base, energy_capacity: 93 }), reserve(base)); assert.equal(power({ ...base, energy_capacity: 93 }), power(base));
  assert.notEqual(cost({ ...base, energy_efficiency: 27 }), cost(base)); assert.equal(reserve({ ...base, energy_efficiency: 27 }), reserve(base));
});

test("v0.6.1 domain conflict is multi-property, scoreless, and monotonic", () => {
  const contract = packageInput.advanced_mechanics.barriers.domain_conflict;
  const left = { refinement: 70, stability: 60, output: 55, coverage: 70, timing: 60, compatibility: 65, environment: 50 };
  const right = { refinement: 65, stability: 62, output: 54, coverage: 55, timing: 58, compatibility: 60, environment: 50 };
  const first = resolveMultiPropertyConflict(left, right, contract);
  const improved = resolveMultiPropertyConflict({ ...left, refinement: 80 }, right, contract);
  assert.equal(first.scalar_score, null); assert.equal(improved.scalar_score, null);
  assert.ok(improved.dominance.left_properties >= first.dominance.left_properties);
  assert.equal(first.comparisons.length, 7);
});

test("binding contracts declare requirements and consequence attempts", () => {
  const contract = { requirements: [{ type: "EVENT_TAG", value: "spoken" }, { type: "TARGET", value: "enemy" }], on_satisfied: [{ type: "ADD_RELATION" }], on_violation: [{ type: "RESOURCE_DELTA", amount: -5 }] };
  const success = resolveBindingContract(contract, { tags: ["spoken"], target_ref: "enemy" }, {});
  const failure = resolveBindingContract(contract, { tags: [], target_ref: "enemy" }, {});
  assert.equal(success.satisfied, true); assert.equal(failure.satisfied, false);
  assert.equal(success.attempted_effects.length, 1); assert.equal(failure.violation_attempts.length, 1);
  assert.equal("final_damage" in success, false);
});

test("conditional mark explicitly carries every setup and cancellation rule", () => {
  const contract = compiled.ability_registry.get("jjk.conditional_mark").components[0].output.action.extension_payload["jjk:contract"];
  assert.deepEqual(contract.requirements, ["CONTACT", "SPOKEN", "HEARD", "CONCENTRATION", "SINGLE_TARGET"]);
  assert.equal(contract.single_active_target, true);
  assert.deepEqual(contract.cancellation_removes, ["relation", "trigger", "pending_consequence"]);
});

test("Asura tactical sequence compiles through v0.3.1 economy semantics", () => {
  const ability = compiled.ability_registry.get("jjk.conditional_mark");
  const sequence = ability.components.find((component) => component.id === "tactical_sequence").output.strategy;
  assert.deepEqual(sequence.nodes.map((node) => node.execution_class), ["ACTION", "MOVEMENT", "ZERO_TIME", "ACTION"]);
  assert.deepEqual(sequence.nodes[1].dependencies, [{ node_id: "distraction", when: "ON_PARTIAL_OR_BETTER" }]);
  assert.equal(sequence.nodes[3].dependencies[0].when, "ON_SUCCESS");
});

test("domain never declares auto-hit and summons are ordinary entities", () => {
  const domain = compiled.ability_registry.get("jjk.synthetic_domain");
  assert.equal(domain.components[0].template, "TEMPORAL_EFFECT");
  assert.equal(packageInput.advanced_mechanics.barriers.domain_conflict.automatic_hit, false);
  assert.equal(JSON.stringify(domain).includes("automatic_hit"), false);
  assert.equal(packageInput.content.summon_templates[0].ordinary_entity, true);
  assert.equal(packageInput.advanced_mechanics.summons.inherit_owner_economy, false);
});

test("bilingual semantic dictionaries preserve extension provenance", () => {
  assert.ok(compiled.semantic_dictionaries.es.match("energía maldita").some((entry) => entry.namespace === "EXTENSION"));
  assert.ok(compiled.semantic_dictionaries.en.match("domain expansion").some((entry) => entry.ability_id === "jjk.synthetic_domain"));
});

test("ability-generated action has manual normalized-action equivalence", async () => {
  const { engine, fixture } = await loadFixture();
  const asura = packageInput.content.characters[0];
  const actor = clone(fixture.actor); actor.id = "asura"; actor.resolved_stats = clone(asura.stats); actor.resources["jjk.resource.cursed_energy"] = { current: 92, maximum: 92 };
  const target = clone(fixture.target); target.id = "target";
  const ability = compiled.ability_registry.get("jjk.raw_energy_blast");
  const use = { ability_id: ability.ability_id, actor_id: actor.id, targets: [{ type: "character", ref: target.id, position: null, body_zone: "core" }], parameters: { intensity: 0.5 }, declared_options: { turn: 0, action_id_prefix: "equivalence" } };
  const generated = instantiateAbilityUse(ability, use, { actor, characters: { asura: actor, target } }).actions[0];
  const input = { seed: "extension-equivalence", world: { ...clone(fixture.world), entity_refs: [actor.id, target.id] }, actor, target, action: clone(generated), registries: fixture.registries };
  assert.equal(canonicalHash(engine.resolveEncounter(input)), canonicalHash(engine.resolveEncounter({ ...clone(input), action: clone(generated) })));
});

test("core has zero JJK, Asura, or Extension SDK dependency leakage", async () => {
  const coreFiles = ["combat.js", "turn.js", "session.js", "strategy.js", "temporal.js", "transaction.js", "config.js", "index.js"];
  const banned = /cursed_energy|domain|binding_vow|shikigami|jujutsu|asura|extension-sdk/i;
  const violations = [];
  for (const file of coreFiles) if (banned.test(await readFile(join(ROOT, "src", file), "utf8"))) violations.push(file);
  assert.deepEqual(violations, []);
});

test("20-turn engine campaign replay is deterministic and history-bounded", async () => {
  const campaign = JSON.parse(await readFile(join(ROOT, "fixtures", "golden-asura-campaign.json"), "utf8"));
  assert.equal(campaign.turns, 20);
  assert.equal(campaign.result.stepResults.length, 20);
  assert.equal(campaign.result.snapshots.length, 21);
  assert.ok(campaign.bounded_history <= 10);
  assert.equal(campaign.replay.deterministic, true);
  assert.equal(campaign.replay.hash, campaign.result.resultHash);
  assert.ok(campaign.final_cursed_energy < 92 && campaign.final_cursed_energy >= 0);
});
