import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCombatScenarios, loadEngineConfig } from "../src/index.js";

const config = await loadEngineConfig();
const reference = JSON.parse(await readFile(join(config.specDir, "fixtures", "reference-encounter.json"), "utf8"));
const fixture = buildCombatScenarios(reference);
const path = join(config.specDir, "fixtures", "combat-scenarios.json");
await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
await writeFile(join(config.specDir, "fixtures", "golden-turn-input.json"), `${JSON.stringify(fixture.scenarios.E, null, 2)}\n`, "utf8");
console.log(`Generated ${Object.keys(fixture.scenarios).length} normalized combat-loop scenarios at ${path}`);
