import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultEngine } from "../src/index.js";
import { buildGenericAbilityDefinitions } from "../src/ability-parser/fixtures.js";

const engine = await createDefaultEngine();
const payload = { version: "0.4.0", abilities: buildGenericAbilityDefinitions() };
await writeFile(join(engine.config.specDir, "fixtures", "ability-definitions.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.abilities.length} generic ability definitions.`);
