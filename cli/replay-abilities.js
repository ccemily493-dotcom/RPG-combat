import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAbilityGoldenSet } from "./ability-goldens.js";
import { stableStringify } from "../src/utils.js";

const update = process.argv.includes("--update");
const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const names = { compiled: "golden-compiled-ability.json", abilityUse: "golden-ability-use.json", abilityCombat: "golden-ability-combat.json", abilitySession: "golden-ability-session.json" };
const golden = await buildAbilityGoldenSet();
for (const [key, file] of Object.entries(names)) {
  const path = join(root, "fixtures", file);
  const serialized = `${stableStringify(golden[key])}\n`;
  if (update) {
    await writeFile(path, serialized, "utf8");
    console.log(`Ability golden ${key} updated: ${golden.hashes[key]}`);
  } else {
    const expected = JSON.parse(await readFile(path, "utf8"));
    const expectedCanonical = stableStringify(expected);
    const actualCanonical = stableStringify(golden[key]);
    if (expectedCanonical !== actualCanonical) {
      console.error(`Ability golden ${key} mismatch: expected committed fixture, got ${golden.hashes[key]}`);
      process.exitCode = 1;
    } else console.log(`Ability golden ${key} matched: ${golden.hashes[key]}; bytes=${Buffer.byteLength(actualCanonical)}`);
  }
}
