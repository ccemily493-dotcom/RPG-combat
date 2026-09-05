import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { semanticError } from "./errors.js";

export const SEMANTIC_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FILES = Object.freeze([
  "semantic-dictionary-entry.schema.json",
  "semantic-intent.schema.json",
  "semantic-parse-result.schema.json",
  "ability-use.schema.json"
]);
const pairs = await Promise.all(FILES.map(async (file) => [file, JSON.parse(await readFile(join(SEMANTIC_ROOT, file), "utf8"))]));
export const semanticSchemas = Object.freeze(Object.fromEntries(pairs));
const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
for (const schema of Object.values(semanticSchemas)) ajv.addSchema(schema);
const validators = Object.freeze({
  dictionaryEntry: ajv.getSchema(semanticSchemas["semantic-dictionary-entry.schema.json"].$id),
  intent: ajv.getSchema(semanticSchemas["semantic-intent.schema.json"].$id),
  parseResult: ajv.getSchema(semanticSchemas["semantic-parse-result.schema.json"].$id)
});

export function validateSemanticSchema(kind, value) {
  const validator = validators[kind];
  if (!validator) throw semanticError("SEMANTIC_SCHEMA_ERROR", `Unknown semantic schema ${kind}.`, kind);
  if (!validator(value)) throw semanticError("SEMANTIC_SCHEMA_ERROR", `${kind} failed JSON Schema validation.`, kind, null, structuredClone(validator.errors));
  return value;
}
