import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { deepFreeze } from "../utils.js";
import { SEMANTIC_ROOT } from "./schemas.js";

export async function loadSemanticConfig(root = SEMANTIC_ROOT) {
  const spec = parseYaml(await readFile(join(root, "semantic.yaml"), "utf8"), { uniqueKeys: true });
  if (spec.spec_version !== "0.5") throw new Error("semantic.yaml must declare spec_version 0.5.");
  return deepFreeze({ root, version: "0.5", spec });
}

export function semanticCoefficient(node) {
  if (!node || !Number.isFinite(node.value)) throw new TypeError("Expected semantic coefficient.");
  return node.value;
}
