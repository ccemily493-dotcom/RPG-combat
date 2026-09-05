import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultEngine, loadSessionScenarios, stableStringify } from "../src/index.js";

const engine = await createDefaultEngine();
const updating = process.argv.includes("--update");

async function readExpected(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (!updating) throw error;
    return null;
  }
}

const encounterInput = JSON.parse(await readFile(join(engine.config.specDir, "fixtures", "reference-encounter.json"), "utf8"));
const encounterGoldenPath = join(engine.config.specDir, "fixtures", "golden-result.json");
const encounterReplay = engine.replay(encounterInput, await readExpected(encounterGoldenPath));
if (!encounterReplay.deterministic) throw new Error("Reference encounter replay is not deterministic.");

const turnInput = JSON.parse(await readFile(join(engine.config.specDir, "fixtures", "golden-turn-input.json"), "utf8"));
const turnGoldenPath = join(engine.config.specDir, "fixtures", "golden-turn-result.json");
const turnReplay = engine.replayTurn(turnInput, await readExpected(turnGoldenPath));
if (!turnReplay.deterministic) throw new Error("Reference turn replay is not deterministic.");

const { scenarios: sessionScenarios } = await loadSessionScenarios(engine.config.specDir);
const sessionGoldenPath = join(engine.config.specDir, "fixtures", "golden-session-result.json");
const sessionReplay = engine.replaySession(sessionScenarios.N, await readExpected(sessionGoldenPath));
if (!sessionReplay.deterministic) throw new Error("Reference session replay is not deterministic.");

if (updating) {
  await writeFile(encounterGoldenPath, `${JSON.stringify(encounterReplay.result, null, 2)}\n`, "utf8");
  await writeFile(turnGoldenPath, `${JSON.stringify(turnReplay.result, null, 2)}\n`, "utf8");
  await writeFile(sessionGoldenPath, `${JSON.stringify(sessionReplay.result, null, 2)}\n`, "utf8");
  console.log(`Golden encounter replay updated: ${encounterReplay.actualHash}`);
  console.log(`Golden multi-action turn replay updated: ${turnReplay.actualHash}`);
  console.log(`Golden five-turn session replay updated: ${sessionReplay.actualHash}`);
} else {
  let failed = false;
  if (!encounterReplay.matchesExpected) {
    console.error(`Encounter golden mismatch. expected=${encounterReplay.expectedHash} actual=${encounterReplay.actualHash}`);
    failed = true;
  } else {
    console.log(`Golden encounter replay matched: ${encounterReplay.actualHash}; bytes=${Buffer.byteLength(stableStringify(encounterReplay.result))}`);
  }
  if (!turnReplay.matchesExpected) {
    console.error(`Turn golden mismatch. expected=${turnReplay.expectedHash} actual=${turnReplay.actualHash}`);
    failed = true;
  } else {
    console.log(`Golden multi-action turn replay matched: ${turnReplay.actualHash}; bytes=${Buffer.byteLength(stableStringify(turnReplay.result))}`);
  }
  if (!sessionReplay.matchesExpected) {
    console.error(`Session golden mismatch. expected=${sessionReplay.expectedHash} actual=${sessionReplay.actualHash}`);
    failed = true;
  } else {
    console.log(`Golden five-turn session replay matched: ${sessionReplay.actualHash}; bytes=${Buffer.byteLength(stableStringify(sessionReplay.result))}`);
  }
  if (failed) process.exitCode = 1;
}
