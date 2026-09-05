import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultEngine, loadCombatScenarios, loadSessionScenarios } from "../src/index.js";

export async function loadFixture() {
  const engine = await createDefaultEngine();
  const fixture = JSON.parse(await readFile(join(engine.config.specDir, "fixtures", "reference-encounter.json"), "utf8"));
  return { engine, fixture };
}

export async function loadScenarioFixture() {
  const engine = await createDefaultEngine();
  const fixture = await loadCombatScenarios(engine.config.specDir);
  return { engine, scenarios: fixture.scenarios };
}

export async function loadSessionScenarioFixture() {
  const engine = await createDefaultEngine();
  const fixture = await loadSessionScenarios(engine.config.specDir);
  return { engine, scenarios: fixture.scenarios };
}

export function clone(value) {
  return structuredClone(value);
}

export function deterministicNumbers(count, seed = 0x12345678) {
  let state = seed >>> 0;
  const values = [];
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values.push(state / 0x100000000);
  }
  return values;
}
