import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSemanticInput } from "../src/semantic-input/index.js";
import { createSemanticToolContext } from "./semantic-context.js";

const cases = [
  ["A", "le pego"], ["B", "le doy una patada"], ["C", "me alejo"], ["D", "esquivo"],
  ["E", "uso Heavy Strike contra B"], ["F", "corro hacia B y lo golpeo"],
  ["G", "tiro algo a su izquierda para distraerlo y me muevo detrás"],
  ["H", "le doy una patada en la pierna"], ["I", "ataco a B y C"], ["J", "disparo cinco veces"],
  ["K", "no lo ataco"], ["L", "ataco al enemigo"], ["M", "hago una cosa indescriptible"],
  ["N", "kick him", "en"], ["O", "le meto un golpe"], ["X", "ataco a B"],
  ["Y", "le pego"], ["Z", "le pego"], ["AA", "ataco al enemigo más cercano"], ["AB", "ataco al mejor objetivo"]
];
const contexts = { L: { defaultTargets: [], focus: [] }, I: { defaultTargets: [], focus: [] }, X: { defaultTargets: [], focus: [] }, Z: { defaultTargets: [], focus: ["b", "c"] }, AA: { defaultTargets: [], focus: [] }, AB: { defaultTargets: [], focus: [] } };
const output = [];
for (const [id, text, locale = "es"] of cases) {
  const tool = await createSemanticToolContext(locale);
  const result = await parseSemanticInput(text, { dictionary: tool.dictionary, config: tool.config, locale, context: { ...tool.context, ...(contexts[id] ?? {}) } });
  output.push({ scenario: id, text, locale, result });
}
const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
await writeFile(join(root, "fixtures", "semantic-input-scenarios.json"), `${JSON.stringify({ version: "0.5.0", scenarios: output }, null, 2)}\n`, "utf8");
console.log(`Wrote ${output.length} deterministic Semantic Input scenarios.`);
