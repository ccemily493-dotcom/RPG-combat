import Ajv2020 from "ajv/dist/2020.js";
import { ValidationError } from "./errors.js";

export function compileSchemas(config) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  for (const schema of Object.values(config.schemas)) ajv.addSchema(schema);
  const validators = {
    world: ajv.getSchema(config.schemas["world-state.schema.json"].$id),
    character: ajv.getSchema(config.schemas["character-state.schema.json"].$id),
    action: ajv.getSchema(config.schemas["action.schema.json"].$id),
    reaction: ajv.getSchema(config.schemas["reaction.schema.json"].$id),
    defenseSources: ajv.getSchema(config.schemas["defense-source-registry.schema.json"].$id),
    statusDefinitions: ajv.getSchema(config.schemas["status-definition-registry.schema.json"].$id),
    turn: ajv.getSchema(config.schemas["turn.schema.json"].$id),
    temporalState: ajv.getSchema(config.schemas["temporal-state.schema.json"].$id),
    strategyDag: ajv.getSchema(config.schemas["strategy-dag.schema.json"].$id),
    session: ajv.getSchema(config.schemas["session.schema.json"].$id)
  };

  function validate(kind, value) {
    const validator = validators[kind];
    if (!validator) throw new ValidationError(`Unknown schema kind: ${kind}`);
    if (!validator(value)) {
      throw new ValidationError(`${kind} failed JSON Schema validation.`, structuredClone(validator.errors));
    }
    return value;
  }

  return Object.freeze({ ajv, validators: Object.freeze(validators), validate });
}
