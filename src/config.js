import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { deepFreeze } from "./utils.js";
import { ValidationError } from "./errors.js";

export const SPEC_FILES = Object.freeze([
  "stats.yaml",
  "categories.yaml",
  "modifiers.yaml",
  "attack.yaml",
  "defense.yaml",
  "damage.yaml",
  "strategy.yaml",
  "parser.yaml",
  "invariants.yaml",
  "combat-loop.yaml",
  "balance.yaml",
  "temporal.yaml"
]);

export const SCHEMA_FILES = Object.freeze([
  "world-state.schema.json",
  "character-state.schema.json",
  "action.schema.json",
  "reaction.schema.json",
  "defense-source-registry.schema.json",
  "status-definition-registry.schema.json",
  "turn.schema.json",
  "temporal-state.schema.json",
  "strategy-dag.schema.json",
  "session.schema.json"
]);

export const DEFAULT_SPEC_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

async function readYaml(path) {
  return parseYaml(await readFile(path, "utf8"), { uniqueKeys: true });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadEngineConfig(specDir = DEFAULT_SPEC_DIR) {
  const yamlEntries = await Promise.all(
    SPEC_FILES.map(async (file) => [file, await readYaml(join(specDir, file))])
  );
  const schemaEntries = await Promise.all(
    SCHEMA_FILES.map(async (file) => [file, await readJson(join(specDir, file))])
  );
  const specs = Object.fromEntries(yamlEntries);
  const schemas = Object.fromEntries(schemaEntries);

  const versions = new Set(Object.values(specs).map((spec) => spec.spec_version));
  if (versions.size !== 1 || !versions.has("0.3")) {
    throw new ValidationError("All YAML specifications must declare spec_version 0.3.", [...versions]);
  }

  return deepFreeze({ specDir, version: "0.3", specs, schemas });
}

export function coefficient(node) {
  if (!node || typeof node !== "object" || !Number.isFinite(node.value)) {
    throw new ValidationError("Expected a configured numeric coefficient.", node);
  }
  return node.value;
}
