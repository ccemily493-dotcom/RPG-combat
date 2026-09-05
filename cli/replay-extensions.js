import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { instantiateAbilityUse } from "../src/ability-parser/index.js";
import { compileExtensionPackages, readExtensionPackage } from "../src/extension-sdk/index.js";
import { canonicalHash, stableStringify } from "../src/utils.js";
import { applyTemporalEffect, createDefaultEngine, loadCombatScenarios, loadSessionScenarios } from "../src/index.js";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const input = await readExtensionPackage(join(root, "extensions", "jjk-reference"));
const stats = ["physical_capability", "movement", "reaction", "coordination", "resistance", "perception", "strategy", "energy_capacity", "energy_output", "energy_control", "energy_efficiency"];
const compiled = compileExtensionPackages([input], { rulesetVersion: "0.3", stats, resources: ["health", "stability", "energy"] });
const packageSnapshot = {
  sdk_version: compiled.sdk_version, ruleset_version: compiled.ruleset_version, package_order: compiled.package_order,
  manifests: compiled.manifests, registries: compiled.registries, scaling_profiles: compiled.scaling_profiles,
  ability_registry: compiled.ability_registry.snapshot(), semantics: Object.fromEntries(Object.entries(compiled.semantic_dictionaries).map(([locale, dictionary]) => [locale, dictionary.inspect()])),
  mechanical_hash: compiled.mechanical_hash, provenance_hash: compiled.provenance_hash, diagnostics: compiled.diagnostics
};
const asura = input.content.characters[0];
const actor = { id: asura.id, resolved_stats: asura.stats, resources: { ...asura.resources, health: { current: 100, maximum: 100 }, stability: { current: 100, maximum: 100 }, energy: { current: 100, maximum: 100 } } };
const ability = compiled.ability_registry.get("jjk.raw_energy_blast");
const abilityUse = instantiateAbilityUse(ability, { ability_id: ability.ability_id, actor_id: actor.id, targets: [{ type: "character", ref: "target", position: null, body_zone: null }], parameters: { intensity: 0.5 }, declared_options: { turn: 0, action_id_prefix: "golden-asura" } }, { actor, characters: { [actor.id]: actor, target: actor } });
const engine = await createDefaultEngine();
const base = structuredClone((await loadSessionScenarios(engine.config.specDir)).scenarios.N);
const combatScenarios = await loadCombatScenarios(engine.config.specDir);
base.id = "golden-asura-campaign"; base.trace = true;
base.initial_snapshot.characters.a.name = "Asura";
base.initial_snapshot.characters.a.resolved_stats = structuredClone(asura.stats);
base.initial_snapshot.characters.a.resources["jjk.resource.cursed_energy"] = { current: 92, maximum: 92 };
base.initial_snapshot.characters.b.resources["jjk.resource.cursed_energy"] = { current: 40, maximum: 40 };
base.initial_snapshot.world.extension_state["jjk:campaign"] = { phase: "reference_validation" };
const conditional = compiled.ability_registry.get("jjk.conditional_mark");
const conditionalUse = instantiateAbilityUse(conditional, { ability_id: conditional.ability_id, actor_id: "a", targets: [{ type: "character", ref: "b", position: null, body_zone: "core" }], parameters: {}, declared_options: { turn: 0, action_id_prefix: "campaign-conditional" } }, { actor: base.initial_snapshot.characters.a, characters: base.initial_snapshot.characters });
base.initial_snapshot.strategies = conditionalUse.strategy_fragments;
const domain = compiled.ability_registry.get("jjk.synthetic_domain");
const domainUse = instantiateAbilityUse(domain, { ability_id: domain.ability_id, actor_id: "a", targets: [], parameters: {}, declared_options: { turn: 0 } }, { actor: base.initial_snapshot.characters.a, characters: base.initial_snapshot.characters });
applyTemporalEffect(base.initial_snapshot, domainUse.temporal_effects[0], { declarations: { actions: [], reactions: [] }, events: [], creation_turn: 0 }, "campaign-domain");
const reinforcement = compiled.ability_registry.get("jjk.reinforcement");
const reinforcementUse = instantiateAbilityUse(reinforcement, { ability_id: reinforcement.ability_id, actor_id: "a", targets: [], parameters: {}, declared_options: { turn: 0 } }, { actor: base.initial_snapshot.characters.a, characters: base.initial_snapshot.characters });
applyTemporalEffect(base.initial_snapshot, reinforcementUse.temporal_effects[0], { declarations: { actions: [], reactions: [] }, events: [], creation_turn: 0 }, "campaign-reinforcement");
base.registries = { ...base.registries, defense_sources: { ...base.registries.defense_sources, ...compiled.registries.defense_sources }, status_definitions: { ...base.registries.status_definitions, ...compiled.registries.status_definitions } };
base.steps = Array.from({ length: 20 }, (_, turn) => {
  const blastUse = instantiateAbilityUse(ability, { ability_id: ability.ability_id, actor_id: "a", targets: [{ type: "character", ref: "b", position: null, body_zone: "core" }], parameters: { intensity: 0.5 }, declared_options: { turn, action_id_prefix: `campaign-blast-${turn}` } }, { actor: base.initial_snapshot.characters.a, characters: base.initial_snapshot.characters });
  let actions = turn % 4 === 1 ? blastUse.actions : [];
  if (turn === 3) actions = conditionalUse.actions.map((action) => ({ ...structuredClone(action), turn: 3, id: "campaign-conditional-contact" }));
  if (turn === 6) {
    const barrier = compiled.ability_registry.get("jjk.barrier_field");
    actions = instantiateAbilityUse(barrier, { ability_id: barrier.ability_id, actor_id: "a", targets: [{ type: "self", ref: "a", position: null, body_zone: null }], parameters: {}, declared_options: { turn, action_id_prefix: "campaign-barrier" } }, { actor: base.initial_snapshot.characters.a, characters: base.initial_snapshot.characters }).actions;
  }
  const reactions = turn === 1 ? [{ ...structuredClone(combatScenarios.scenarios.F.reactions[0]), id: "campaign-block", target_action_id: blastUse.actions[0].id }] : [];
  return { declarations: { actions, reactions }, seed: `jjk.reference.campaign.17:${turn}` };
});
const campaignResult = engine.resolveSession(base);
const campaignReplay = engine.replaySession(base, campaignResult);
if (!campaignReplay.deterministic || !campaignReplay.matchesExpected) throw new Error("Asura campaign replay is not deterministic.");
const campaign = { result: campaignResult, replay: { deterministic: campaignReplay.deterministic, hash: campaignResult.resultHash }, turns: 20, bounded_history: campaignResult.finalSnapshot.temporal_state.mechanical_history.length, final_cursed_energy: campaignResult.finalSnapshot.characters.a.resources["jjk.resource.cursed_energy"].current };
const values = { packageSnapshot, abilityUse, campaign };
const names = { packageSnapshot: "golden-extension-package.json", abilityUse: "golden-jjk-ability-use.json", campaign: "golden-asura-campaign.json" };
const update = process.argv.includes("--update");
for (const [key, file] of Object.entries(names)) {
  const path = join(root, "fixtures", file); const actual = stableStringify(values[key]); const hash = canonicalHash(values[key]);
  if (update) { await writeFile(path, `${actual}\n`, "utf8"); console.log(`Extension golden ${key} updated: ${hash}`); }
  else { const expected = stableStringify(JSON.parse(await readFile(path, "utf8"))); if (actual !== expected) { console.error(`Extension golden ${key} mismatch: ${hash}`); process.exitCode = 1; } else console.log(`Extension golden ${key} matched: ${hash}; bytes=${Buffer.byteLength(actual)}`); }
}
