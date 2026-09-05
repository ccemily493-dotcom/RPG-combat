import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stableStringify } from "../src/utils.js";
import { buildSemanticGoldenSet } from "./semantic-goldens.js";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const update = process.argv.includes("--update");
const names = { basic: "golden-semantic-basic.json", strategy: "golden-semantic-strategy.json", ability: "golden-semantic-ability.json", fallback: "golden-semantic-fallback.json", semanticSession: "golden-semantic-session.json" };
const golden = await buildSemanticGoldenSet();
for (const [key, file] of Object.entries(names)) {
  const path = join(root, "fixtures", file); const canonical = stableStringify(golden[key]);
  if (update) { await writeFile(path, `${canonical}\n`, "utf8"); console.log(`Semantic golden ${key} updated: ${golden.hashes[key]}`); }
  else {
    const expected = stableStringify(JSON.parse(await readFile(path, "utf8")));
    if (expected !== canonical) { console.error(`Semantic golden ${key} mismatch: ${golden.hashes[key]}`); process.exitCode = 1; }
    else console.log(`Semantic golden ${key} matched: ${golden.hashes[key]}; bytes=${Buffer.byteLength(canonical)}`);
  }
}
