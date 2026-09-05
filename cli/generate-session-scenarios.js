import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSessionScenarios, loadEngineConfig } from "../src/index.js";

const config = await loadEngineConfig();
const combat = JSON.parse(await readFile(join(config.specDir, "fixtures", "combat-scenarios.json"), "utf8"));
const fixture = buildSessionScenarios(combat.scenarios);
const path = join(config.specDir, "fixtures", "session-scenarios.json");
await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(`Generated ${Object.keys(fixture.scenarios).length} normalized session scenarios at ${path}`);
