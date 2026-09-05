import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createEngine, generateSpecializedProfiles, lint, loadCombatScenarios, loadDefenseCompositionProfiles, loadEngineConfig, loadProfileTemplates, loadSessionScenarios, validateSpecializedProfiles } from "../src/index.js";
import { compileAbilityRegistry } from "../src/ability-parser/index.js";
import { buildSemanticDictionaryEntries, compileSemanticDictionary, loadSemanticConfig, parseSemanticInput, semanticEntities } from "../src/semantic-input/index.js";
import { compileExtensionPackages, readExtensionPackage, validateExtensionManifest } from "../src/extension-sdk/index.js";

const config = await loadEngineConfig();
const result = await lint(config);
if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  const engine = createEngine(config);
  const fixture = JSON.parse(await readFile(join(config.specDir, "fixtures", "reference-encounter.json"), "utf8"));
  engine.schemas.validate("world", fixture.world);
  engine.schemas.validate("character", fixture.actor);
  engine.schemas.validate("character", fixture.target);
  engine.schemas.validate("action", fixture.action);
  engine.schemas.validate("defenseSources", fixture.registries.defense_sources);
  engine.schemas.validate("statusDefinitions", fixture.registries.status_definitions);
  const combatScenarios = await loadCombatScenarios(config.specDir);
  for (const scenario of Object.values(combatScenarios.scenarios)) engine.schemas.validate("turn", scenario);
  const sessionScenarios = await loadSessionScenarios(config.specDir);
  for (const scenario of Object.values(sessionScenarios.scenarios)) {
    for (const step of scenario.steps) engine.schemas.validate("session", {
      id: scenario.id,
      snapshot: scenario.initial_snapshot,
      declarations: step.declarations,
      registries: scenario.registries,
      seed: step.seed,
      trace: true
    });
  }
  const templates = await loadProfileTemplates(config.specDir);
  const generated = generateSpecializedProfiles(config, templates);
  const profileValidation = validateSpecializedProfiles(config, generated);
  if (!profileValidation.ok) throw new Error(profileValidation.issues.join("\n"));
  await loadDefenseCompositionProfiles(config.specDir);
  const referenceScenario = combatScenarios.scenarios.A;
  const abilityFixture = JSON.parse(await readFile(join(config.specDir, "fixtures", "ability-definitions.json"), "utf8"));
  const abilityRegistry = compileAbilityRegistry(abilityFixture.abilities, {
    rulesetVersion: config.version,
    stats: Object.keys(config.specs["stats.yaml"].stats),
    resources: Object.keys(referenceScenario.characters.a.resources),
    registries: referenceScenario.registries
  });
  const semanticConfig = await loadSemanticConfig(config.specDir);
  const semanticEntries = buildSemanticDictionaryEntries(abilityRegistry);
  const semanticDictionaries = ["es", "en"].map((locale) => compileSemanticDictionary(semanticEntries, { locale }));
  const semanticProbe = await parseSemanticInput("le pego", {
    dictionary: semanticDictionaries[0], config: semanticConfig, locale: "es",
    context: { actorId: "a", entities: semanticEntities(), defaultTargets: ["b"], focus: ["b"], abilityRegistry, world: referenceScenario.world, characters: referenceScenario.characters }
  });
  if (semanticProbe.status !== "RESOLVED") throw new Error("Semantic Input validation probe did not resolve.");
  const extensionInput = await readExtensionPackage(join(config.specDir, "extensions", "jjk-reference"));
  validateExtensionManifest(extensionInput.manifest);
  const extension = compileExtensionPackages([extensionInput], {
    rulesetVersion: config.version,
    stats: Object.keys(config.specs["stats.yaml"].stats),
    resources: ["health", "stability", "energy"]
  });
  if (extension.ability_registry.size !== 8) throw new Error("Reference extension ability registry is incomplete.");
  await Promise.all(["variance-distributions.yaml", "parameter-sweeps.yaml"].map(async (file) => {
    parseYaml(await readFile(join(config.specDir, "experiments", file), "utf8"), { uniqueKeys: true });
  }));
  console.log(`Specifications valid: ${Object.keys(config.specs).length} engine YAML files plus semantic.yaml, ${Object.keys(config.schemas).length} engine JSON Schemas, 3 Ability Parser and 3 Semantic Input JSON Schemas, extension manifest schema, 3 experimental profiles, ${generated.profiles.length} benchmark profiles, ${abilityRegistry.size} generic abilities, ${extension.ability_registry.size} extension abilities, ${semanticDictionaries.map((item) => `${item.locale}:${item.size}`).join(", ")} semantic entries, reference encounter, ${Object.keys(combatScenarios.scenarios).length} combat-loop scenarios, and ${Object.keys(sessionScenarios.scenarios).length} temporal/strategy scenarios.`);
}
