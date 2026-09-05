import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { clone, loadFixture, loadSessionScenarioFixture } from "./helpers.js";

test("reference encounter matches the committed golden replay", async () => {
  const { engine, fixture } = await loadFixture();
  const expected = JSON.parse(await readFile(join(engine.config.specDir, "fixtures", "golden-result.json"), "utf8"));
  const replay = engine.replay(clone(fixture), expected);
  assert.equal(replay.deterministic, true);
  assert.equal(replay.matchesExpected, true, `expected ${replay.expectedHash}, got ${replay.actualHash}`);
});

test("multi-action turn matches the committed golden replay", async () => {
  const { engine } = await loadFixture();
  const input = JSON.parse(await readFile(join(engine.config.specDir, "fixtures", "golden-turn-input.json"), "utf8"));
  const expected = JSON.parse(await readFile(join(engine.config.specDir, "fixtures", "golden-turn-result.json"), "utf8"));
  const replay = engine.replayTurn(input, expected);
  assert.equal(replay.deterministic, true);
  assert.equal(replay.matchesExpected, true, `expected ${replay.expectedHash}, got ${replay.actualHash}`);
});

test("five-turn Strategy DAG session matches the committed golden replay", async () => {
  const { engine, scenarios } = await loadSessionScenarioFixture();
  const expected = JSON.parse(await readFile(join(engine.config.specDir, "fixtures", "golden-session-result.json"), "utf8"));
  const replay = engine.replaySession(clone(scenarios.N), expected);
  assert.equal(replay.deterministic, true);
  assert.equal(replay.matchesExpected, true, `expected ${replay.expectedHash}, got ${replay.actualHash}`);
});
