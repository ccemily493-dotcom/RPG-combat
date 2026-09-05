import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSemanticGoldenSet } from "../cli/semantic-goldens.js";
import { stableStringify } from "../src/utils.js";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const names = { basic: "golden-semantic-basic.json", strategy: "golden-semantic-strategy.json", ability: "golden-semantic-ability.json", fallback: "golden-semantic-fallback.json", semanticSession: "golden-semantic-session.json" };

test("v0.5 semantic basic/strategy/ability/fallback/session goldens reproduce canonically", async () => {
  const actual = await buildSemanticGoldenSet();
  for (const [key, file] of Object.entries(names)) assert.equal(stableStringify(actual[key]), stableStringify(JSON.parse(await readFile(join(root, "fixtures", file), "utf8"))), `${key}: ${actual.hashes[key]}`);
  assert.equal(actual.semanticSession.parse.intent.provenance.parser_path, "RULE");
  assert.equal(actual.semanticSession.mechanical_result.stepResults.length, 2);
});
