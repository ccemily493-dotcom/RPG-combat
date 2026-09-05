import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parserError } from "./errors.js";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FILES = Object.freeze([
  "ability-definition.schema.json",
  "compiled-ability.schema.json",
  "ability-use.schema.json",
  "action.schema.json",
  "reaction.schema.json",
  "temporal-state.schema.json",
  "strategy-dag.schema.json",
  "defense-source-registry.schema.json",
  "status-definition-registry.schema.json"
]);

const entries = await Promise.all(FILES.map(async (file) => [file, JSON.parse(await readFile(join(ROOT, file), "utf8"))]));
const schemas = Object.freeze(Object.fromEntries(entries));
const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
for (const schema of Object.values(schemas)) ajv.addSchema(schema);

const validators = Object.freeze({
  definition: ajv.getSchema(schemas["ability-definition.schema.json"].$id),
  compiled: ajv.getSchema(schemas["compiled-ability.schema.json"].$id),
  use: ajv.getSchema(schemas["ability-use.schema.json"].$id),
  action: ajv.getSchema(schemas["action.schema.json"].$id),
  reaction: ajv.getSchema(schemas["reaction.schema.json"].$id),
  strategy: ajv.getSchema(schemas["strategy-dag.schema.json"].$id),
  temporalEffect: ajv.getSchema(`${schemas["temporal-state.schema.json"].$id}#/$defs/effect`),
  relation: ajv.getSchema(`${schemas["temporal-state.schema.json"].$id}#/$defs/relation`),
  opportunity: ajv.getSchema(`${schemas["temporal-state.schema.json"].$id}#/$defs/opportunity`),
  defenseSources: ajv.getSchema(schemas["defense-source-registry.schema.json"].$id)
});

export function validateSchema(kind, value) {
  const validator = validators[kind];
  if (!validator) throw parserError("SCHEMA_ERROR", `Unknown Ability Parser schema kind ${kind}.`, kind);
  if (!validator(value)) throw parserError("SCHEMA_ERROR", `${kind} failed JSON Schema validation.`, kind, structuredClone(validator.errors));
  return value;
}

export { ROOT as ABILITY_SPEC_ROOT, schemas as abilitySchemas };
