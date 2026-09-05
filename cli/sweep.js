import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  buildBenchmarkEncounter,
  createEngine,
  generateSpecializedProfiles,
  loadBenchmarkAssets,
  loadEngineConfig,
  loadProfileTemplates,
  profileIndex,
  runParameterSweep,
  sweepToCsv
} from "../src/index.js";

const baseConfig = await loadEngineConfig();
const templates = await loadProfileTemplates(baseConfig.specDir);
const generated = generateSpecializedProfiles(baseConfig, templates);
const assets = await loadBenchmarkAssets(baseConfig.specDir);
assets.generatedProfiles = generated;
const profiles = profileIndex(generated);
const sweepConfig = parseYaml(await readFile(join(baseConfig.specDir, "experiments", "parameter-sweeps.yaml"), "utf8"), { uniqueKeys: true });
const selectedArgument = process.argv.find((value) => value.startsWith("--sweep="));
const selected = selectedArgument ? selectedArgument.slice("--sweep=".length) : null;
const entries = Object.entries(sweepConfig.sweeps).filter(([id]) => selected === null || id === selected);
if (!entries.length) throw new Error(`Unknown sweep: ${selected}`);
const reportDir = join(baseConfig.specDir, "reports", "sweeps");
await mkdir(reportDir, { recursive: true });

for (const [id, definition] of entries) {
  const attackerProfile = profiles.get("fighter:balanced");
  const defenderProfile = profiles.get("civilian:balanced");
  const metric = definition.metric === "defense_filter" ? (result) => result.defenseFilter : (result) => result.healthDamage;
  const suspicionScore = definition.suspicious_when_below
    ? (row) => Math.max(0, definition.suspicious_when_below.value - row.metric.mean)
    : (row) => Math.max(0, row.metric.mean - definition.suspicious_when_above.value);
  const result = runParameterSweep({
    baseConfig,
    dimensions: definition.dimensions,
    repeats: definition.repeats.value,
    createEngine,
    encounterFactory: (engine, seed) => buildBenchmarkEncounter({
      config: engine.config,
      assets,
      attackerProfile,
      defenderProfile,
      seed,
      trace: false
    }),
    metric,
    suspicionScore
  });
  const document = {
    version: "0.3",
    sweep: id,
    canonicalUnchanged: true,
    matchup: "fighter:balanced vs civilian:balanced",
    metric: definition.metric,
    seedPattern: "sweep:<combination>:<repeat>",
    ...result
  };
  await writeFile(join(reportDir, `${id}.json`), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await writeFile(join(reportDir, `${id}.csv`), sweepToCsv(result), "utf8");
  console.log(`${id}: ${result.combinationCount} combinations x ${result.repeats} repeats; suspicious=${result.rankedSuspicious.length}`);
}
