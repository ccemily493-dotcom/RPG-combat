import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAbilityGoldenSet } from "../cli/ability-goldens.js";
import { stableStringify } from "../src/utils.js";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const names = { compiled: "golden-compiled-ability.json", abilityUse: "golden-ability-use.json", abilityCombat: "golden-ability-combat.json", abilitySession: "golden-ability-session.json" };

test("v0.4 compiled/use/combat/session goldens reproduce byte-for-byte", async () => {
  const actual = await buildAbilityGoldenSet();
  for (const [key, file] of Object.entries(names)) {
    const expected = JSON.parse(await readFile(join(root, "fixtures", file), "utf8"));
    assert.equal(stableStringify(actual[key]), stableStringify(expected), `${key} golden hash ${actual.hashes[key]}`);
  }
  assert.equal(actual.abilitySession.stepResults.length, 2);
  assert.ok(actual.abilitySession.finalSnapshot.characters.b.resources.stability.current < 988);
  assert.ok(actual.abilitySession.stepResults[1].temporalEvents.some((event) => event.type === "scheduled_effect_activated"));
  assert.equal(actual.abilitySession.finalSnapshot.strategies[0].state, "COMPLETED");
});
