import { createDefaultEngine, loadCombatScenarios } from "../src/index.js";
import { buildGenericAbilityDefinitions } from "../src/ability-parser/fixtures.js";
import { compileAbilityRegistry } from "../src/ability-parser/index.js";
import { buildSemanticActionTemplates, buildSemanticDictionaryEntries, compileSemanticDictionary, loadSemanticConfig, semanticEntities } from "../src/semantic-input/index.js";

export async function createSemanticToolContext(locale = "es") {
  const engine = await createDefaultEngine();
  const { scenarios } = await loadCombatScenarios(engine.config.specDir);
  const scenario = scenarios.A;
  const abilityRegistry = compileAbilityRegistry(buildGenericAbilityDefinitions(), {
    rulesetVersion: engine.config.version,
    stats: Object.keys(engine.config.specs["stats.yaml"].stats),
    resources: Object.keys(scenario.characters.a.resources),
    registries: scenario.registries
  });
  const dictionary = compileSemanticDictionary(buildSemanticDictionaryEntries(abilityRegistry), { locale });
  const config = await loadSemanticConfig(engine.config.specDir);
  const context = {
    actorId: "a", locale, entities: semanticEntities(), defaultTargets: ["b"], focus: ["b"], abilityRegistry,
    world: scenario.world, characters: scenario.characters, actionTemplates: buildSemanticActionTemplates(scenario.actions[0]),
    distances: { b: 2, c: 4 }, spatialLabels: { left: ["b"] }
  };
  return { engine, scenario, abilityRegistry, dictionary, config, context };
}
