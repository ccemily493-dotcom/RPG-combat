import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateSpecializedProfiles, loadEngineConfig, loadProfileTemplates, validateSpecializedProfiles } from "../src/index.js";

const config = await loadEngineConfig();
const templates = await loadProfileTemplates(config.specDir);
const generated = generateSpecializedProfiles(config, templates);
const validation = validateSpecializedProfiles(config, generated);
if (!validation.ok) throw new Error(`Generated benchmark profiles are invalid:\n${validation.issues.join("\n")}`);
const path = join(config.specDir, "fixtures", "specialized-benchmark-profiles.json");
await writeFile(path, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
console.log(`Generated ${generated.profiles.length} profiles across ${generated.categoryCount} categories at ${path}`);
