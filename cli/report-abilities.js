import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultEngine, loadCombatScenarios } from "../src/index.js";
import { compileAbilityRegistry, inspectAbility } from "../src/ability-parser/index.js";
import { buildGenericAbilityDefinitions } from "../src/ability-parser/fixtures.js";

const engine = await createDefaultEngine();
const { scenarios } = await loadCombatScenarios(engine.config.specDir);
const scenario = scenarios.A;
const registry = compileAbilityRegistry(buildGenericAbilityDefinitions(), { rulesetVersion: engine.config.version, stats: Object.keys(engine.config.specs["stats.yaml"].stats), resources: Object.keys(scenario.characters.a.resources), registries: scenario.registries });
const abilities = registry.values().map(inspectAbility);
const templates = {};
for (const ability of abilities) for (const [name, count] of Object.entries(ability.templates)) templates[name] = (templates[name] ?? 0) + count;
const report = {
  version: "0.4.0", classification: "ability_diagnostic", non_blocking: true,
  ability_count: abilities.length, templates: Object.fromEntries(Object.entries(templates).sort(([a], [b]) => a.localeCompare(b))),
  average_component_count: abilities.reduce((sum, item) => sum + item.component_count, 0) / abilities.length,
  average_parameter_count: abilities.reduce((sum, item) => sum + item.parameter_count, 0) / abilities.length,
  expression_nodes: abilities.reduce((sum, item) => sum + item.expression_nodes, 0),
  strategy_fragment_count: abilities.reduce((sum, item) => sum + item.strategy_fragment_count, 0),
  invalid_registry_references: 0,
  warnings: abilities.flatMap((ability) => ability.diagnostics.map((warning) => ({ ability_id: ability.ability_id, ...warning }))),
  abilities
};
const dir = join(engine.config.specDir, "reports");
await writeFile(join(dir, "ability-parser-diagnostics-v0.4.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const templateRows = Object.entries(report.templates).map(([name, count]) => `| ${name} | ${count} |`).join("\n");
const markdown = `# Ability Parser v0.4 Diagnostics\n\nThese diagnostics are non-blocking and never retune definitions.\n\n- Abilities: ${report.ability_count}\n- Average components: ${report.average_component_count.toFixed(2)}\n- Average parameters: ${report.average_parameter_count.toFixed(2)}\n- Expression nodes: ${report.expression_nodes}\n- Strategy fragments: ${report.strategy_fragment_count}\n- Invalid registry references: ${report.invalid_registry_references}\n- Suspicious-value warnings: ${report.warnings.length}\n\n| Template | Components |\n|---|---:|\n${templateRows}\n`;
await writeFile(join(dir, "ability-parser-diagnostics-v0.4.md"), markdown, "utf8");
console.log(JSON.stringify(report, null, 2));
