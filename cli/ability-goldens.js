import { applyTemporalEffect, createDefaultEngine, loadCombatScenarios, loadSessionScenarios } from "../src/index.js";
import { canonicalHash, deepClone, deepFreeze } from "../src/utils.js";
import { buildGenericAbilityDefinitions } from "../src/ability-parser/fixtures.js";
import { compileAbilityRegistry } from "../src/ability-parser/registry.js";
import { instantiateAbilityUse } from "../src/ability-parser/compiler.js";

function invocation(id, parameters = {}, options = {}) {
  return { ability_id: id, actor_id: "a", targets: [{ type: "character", ref: "b", position: null, body_zone: "core" }], parameters, declared_options: { turn: 0, ...options } };
}

export async function buildAbilityGoldenSet() {
  const engine = await createDefaultEngine();
  const combat = await loadCombatScenarios(engine.config.specDir);
  const sessions = await loadSessionScenarios(engine.config.specDir);
  const scenario = combat.scenarios.A;
  const context = { rulesetVersion: engine.config.version, stats: Object.keys(engine.config.specs["stats.yaml"].stats), resources: Object.keys(scenario.characters.a.resources), registries: scenario.registries };
  const registry = compileAbilityRegistry(buildGenericAbilityDefinitions(), context);
  const heavy = registry.get("core.example.heavy_strike");
  const compiled = deepClone(heavy);
  const abilityUse = instantiateAbilityUse(registry.get("core.example.parameterized_blast"), invocation("core.example.parameterized_blast", { charge: 0.5 }), { characters: scenario.characters, world: scenario.world });
  const heavyUse = instantiateAbilityUse(heavy, invocation(heavy.ability_id, {}, { action_id_prefix: "golden-heavy" }), { characters: scenario.characters, world: scenario.world });
  const abilityCombat = engine.resolveTurn({ ...deepClone(scenario), id: "golden-ability-combat", actions: heavyUse.actions, reactions: [], seed: "golden-ability-combat", trace: true });
  const tactical = instantiateAbilityUse(registry.get("core.example.tactical_opening"), invocation("core.example.tactical_opening", {}, { action_id_prefix: "golden-tactical" }), { characters: scenario.characters, world: scenario.world });
  const delayed = instantiateAbilityUse(registry.get("core.example.delayed_burst"), invocation("core.example.delayed_burst"), { characters: scenario.characters, world: scenario.world });
  const sessionFixture = deepClone(sessions.scenarios.N);
  sessionFixture.id = "golden-ability-session";
  sessionFixture.initial_snapshot.strategies = tactical.strategy_fragments;
  applyTemporalEffect(sessionFixture.initial_snapshot, delayed.temporal_effects[0], { declarations: { actions: [], reactions: [] }, events: [], creation_turn: 0 }, "golden-delayed-burst");
  sessionFixture.steps = [{ declarations: { actions: [], reactions: [] }, seed: "golden-ability-session:0" }, { declarations: { actions: [], reactions: [] }, seed: "golden-ability-session:1" }];
  sessionFixture.trace = true;
  const abilitySession = engine.resolveSession(sessionFixture);
  const values = { compiled, abilityUse, abilityCombat, abilitySession };
  return deepFreeze({ ...values, hashes: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, canonicalHash(value)])) });
}
