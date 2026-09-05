import { createDefaultEngine, loadCombatScenarios, loadSessionScenarios } from "../src/index.js";
import { buildGenericAbilityDefinitions } from "../src/ability-parser/fixtures.js";
import { compileAbilityRegistry } from "../src/ability-parser/index.js";
import { DeterministicMockFallbackProvider, compileSemanticDictionary, compileSemanticIntent, loadSemanticConfig, parseSemanticInput } from "../src/semantic-input/index.js";
import { buildSemanticActionTemplates, buildSemanticDictionaryEntries, semanticEntities } from "../src/semantic-input/fixtures.js";
import { canonicalHash, deepClone, deepFreeze } from "../src/utils.js";

export async function buildSemanticGoldenSet() {
  const engine = await createDefaultEngine();
  const combat = await loadCombatScenarios(engine.config.specDir);
  const sessions = await loadSessionScenarios(engine.config.specDir);
  const scenario = combat.scenarios.A;
  const abilityRegistry = compileAbilityRegistry(buildGenericAbilityDefinitions(), { rulesetVersion: engine.config.version, stats: Object.keys(engine.config.specs["stats.yaml"].stats), resources: Object.keys(scenario.characters.a.resources), registries: scenario.registries });
  const dictionary = compileSemanticDictionary(buildSemanticDictionaryEntries(abilityRegistry), { locale: "es" });
  const config = await loadSemanticConfig();
  const context = { actorId: "a", locale: "es", entities: semanticEntities(), defaultTargets: ["b"], focus: ["b"], abilityRegistry, world: scenario.world, characters: scenario.characters, actionTemplates: buildSemanticActionTemplates(scenario.actions[0]), distances: { b: 2, c: 4 }, spatialLabels: { left: ["b"] } };
  const options = { dictionary, config, locale: "es", context };
  const basic = await parseSemanticInput("le pego", options);
  const strategy = await parseSemanticInput("tiro algo a su izquierda para distraerlo y me muevo detrás", options);
  const ability = await parseSemanticInput("uso Heavy Strike contra B", options);
  const abilityCompiled = compileSemanticIntent(ability.intent, context);
  const fallbackProvider = new DeterministicMockFallbackProvider("golden-mock", () => ({ intent_type: "ACTION", action: { type: "ATTACK", subtype: "PUNCH", targets: [{ entity_id: "b", source_span: null }], target_zone: null, direction: null, distance: null, intensity: null, quantity: 1, object_ref: null, execution_class: "ACTION", primitive: null }, confidence: { intent_type: 0.8, action: 0.8, target: 0.8 } }));
  const fallback = await parseSemanticInput("le meto un viaje", { ...options, fallbackProvider });
  const tactical = await parseSemanticInput("Uso Tactical Opening contra B", options);
  const tacticalCompiled = compileSemanticIntent(tactical.intent, context);
  const sessionFixture = deepClone(sessions.scenarios.N);
  sessionFixture.id = "golden-semantic-session";
  sessionFixture.initial_snapshot.strategies = tacticalCompiled.ability_payload.strategy_fragments;
  sessionFixture.steps = sessionFixture.steps.slice(0, 2);
  sessionFixture.trace = true;
  const sessionResult = engine.resolveSession(sessionFixture);
  const semanticSession = { parse: tactical, compiled: tacticalCompiled, mechanical_result: sessionResult };
  const values = { basic, strategy, ability: { parse: ability, compiled: abilityCompiled }, fallback, semanticSession };
  return deepFreeze({ ...values, hashes: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, canonicalHash(value)])) });
}
