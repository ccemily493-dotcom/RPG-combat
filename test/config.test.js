import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compileSchemas, lint, loadEngineConfig } from "../src/index.js";

test("all specifications load, lint, and compile", async () => {
  const config = await loadEngineConfig();
  assert.equal(Object.keys(config.specs).length, 12);
  assert.equal(Object.keys(config.schemas).length, 10);
  assert.deepEqual(await lint(config), { ok: true, issues: [] });
  assert.doesNotThrow(() => compileSchemas(config));
});

test("reference fixture validates against every applicable schema", async () => {
  const config = await loadEngineConfig();
  const schemas = compileSchemas(config);
  const fixture = JSON.parse(await readFile(join(config.specDir, "fixtures", "reference-encounter.json"), "utf8"));
  assert.equal(schemas.validate("world", fixture.world), fixture.world);
  assert.equal(schemas.validate("character", fixture.actor), fixture.actor);
  assert.equal(schemas.validate("character", fixture.target), fixture.target);
  assert.equal(schemas.validate("action", fixture.action), fixture.action);
  assert.equal(schemas.validate("defenseSources", fixture.registries.defense_sources), fixture.registries.defense_sources);
  assert.equal(schemas.validate("statusDefinitions", fixture.registries.status_definitions), fixture.registries.status_definitions);
});
