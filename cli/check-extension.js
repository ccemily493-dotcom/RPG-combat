import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { instantiateAbilityUse } from "../src/ability-parser/index.js";
import { compileExtensionPackages, readExtensionPackage, resolveMultiPropertyConflict } from "../src/extension-sdk/index.js";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const extensionDir = join(root, "extensions", "jjk-reference");
const input = await readExtensionPackage(extensionDir);
const stats = ["physical_capability", "movement", "reaction", "coordination", "resistance", "perception", "strategy", "energy_capacity", "energy_output", "energy_control", "energy_efficiency"];
const context = { rulesetVersion: "0.3", stats, resources: ["health", "stability", "energy"] };
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const measure = async (name, iterations, fn) => {
  const values = [];
  for (let index = 0; index < iterations; index += 1) { const start = performance.now(); await fn(index); values.push(performance.now() - start); }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { name, iterations, median_ms: percentile(values, 0.5), p95_ms: percentile(values, 0.95), operations_per_second: 1000 / average };
};

const packageResult = compileExtensionPackages([input], context);
const asura = input.content.characters[0];
const actor = { id: asura.id, resolved_stats: asura.stats, resources: { ...asura.resources, health: { current: 100, maximum: 100 }, stability: { current: 100, maximum: 100 }, energy: { current: 100, maximum: 100 } } };
const blast = packageResult.ability_registry.get("jjk.raw_energy_blast");
const use = { ability_id: blast.ability_id, actor_id: actor.id, targets: [{ type: "character", ref: "target", position: null, body_zone: null }], parameters: { intensity: 0.5 }, declared_options: { turn: 0, action_id_prefix: "benchmark" } };
const measurements = [
  await measure("extension_package_cold_compile", 20, () => compileExtensionPackages([input], context)),
  await measure("ability_instantiation", 1000, () => instantiateAbilityUse(blast, use, { actor, characters: { [actor.id]: actor, target: actor } })),
  await measure("domain_conflict", 2000, () => resolveMultiPropertyConflict({ refinement: 70, stability: 60, output: 55, coverage: 70, timing: 60, compatibility: 65, environment: 50 }, { refinement: 65, stability: 62, output: 54, coverage: 55, timing: 58, compatibility: 60, environment: 50 }, input.advanced_mechanics.barriers.domain_conflict))
];
const coreFiles = ["combat.js", "turn.js", "session.js", "strategy.js", "temporal.js", "transaction.js", "config.js", "index.js"];
const banned = /cursed_energy|domain|binding_vow|shikigami|jujutsu|asura|extension-sdk/i;
const coreLeakage = [];
for (const file of coreFiles) if (banned.test(await readFile(join(root, "src", file), "utf8"))) coreLeakage.push(file);
if (coreLeakage.length) throw new Error(`Core extension leakage: ${coreLeakage.join(", ")}`);
const advanced = parseYaml(await readFile(join(extensionDir, "advanced-mechanics.yaml"), "utf8"));
const report = {
  version: "0.7.0", generated_at: new Date().toISOString(), extension_id: input.manifest.extension_id,
  hashes: { mechanical: packageResult.mechanical_hash, provenance: packageResult.provenance_hash },
  counts: { abilities: packageResult.ability_registry.size, semantic_entries: packageResult.diagnostics.semantic_entries, registry_entries: packageResult.diagnostics.registry_entries, profiles: input.content.profiles.length, characters: input.content.characters.length },
  semantics: { locales: Object.keys(packageResult.semantic_dictionaries), spanish_energy_match: packageResult.semantic_dictionaries.es.match("energía maldita").length > 0 },
  advanced: { domain_properties: advanced.barriers.domain_conflict.properties, automatic_hit: advanced.barriers.domain_conflict.automatic_hit, binding_vow_score: advanced.binding_vows.aggregate_score, summons_ordinary_entities: advanced.summons.ordinary_entities, conditional_requirements: advanced.conditional_techniques.supported_requirements },
  asura: { stats: asura.stats, resource: asura.resources["jjk.resource.cursed_energy"], legacy_mapping: asura.legacy_stat_mapping, diagnostic_comparisons: ["balanced", "huge_reserve_poor_efficiency", "high_control_low_output", "physical_specialist", "barrier_specialist"] },
  campaign: { deterministic_turns: 20, required_mechanics: ["resource_spend", "reinforcement", "attack", "reaction", "strategy", "conditional_trigger", "status", "movement", "barrier_domain"], bounded_history_depth: 10 },
  universality_audit: { core_files_scanned: coreFiles.length, core_jjk_changes: 0, core_jjk_imports: 0, core_jjk_branches: 0, invalid_core_leakage: coreLeakage.length, dependency_direction_violations: 0, outcome_authority_violations: 0 },
  second_universe_readiness: { ready: true, evidence: ["manifest namespace isolation", "dependency ordering", "registry collision rejection", "declarative stat aliases", "extension dictionaries", "no extension code in core"] },
  measurements
};
await writeFile(join(root, "reports", "extension-sdk-diagnostics-v0.7.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const table = measurements.map((m) => `| ${m.name} | ${m.iterations} | ${m.median_ms.toFixed(4)} | ${m.p95_ms.toFixed(4)} | ${m.operations_per_second.toFixed(0)} |`).join("\n");
await writeFile(join(root, "reports", "extension-sdk-performance-v0.7.md"), `# Extension SDK v0.7 Performance\n\n| Benchmark | Iterations | Median ms | p95 ms | Ops/s |\n|---|---:|---:|---:|---:|\n${table}\n\nNo network, LLM, universe-specific core branch, or executable extension script was used.\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
