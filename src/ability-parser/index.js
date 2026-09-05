export {
  ABILITY_PARSER_VERSION,
  compileAbilityDefinition,
  inspectAbility,
  instantiateAbilityUse,
  traceAbilityCompilation,
  validateAbilityDefinition,
  validateCompiledAbility
} from "./compiler.js";
export { AbilityCompilationCache, compileAbilityRegistry } from "./registry.js";
export { evaluateExpression, EXPRESSION_OPERATIONS, isExpression, validateExpression } from "./expression.js";
export { AbilityParserError } from "./errors.js";
export { abilitySchemas, validateSchema } from "./schemas.js";

// Deliberately unimplemented extension point. A future provider may create an
// untrusted candidate Ability Definition, which must still pass normal schema
// validation and compilation before it can reach the RPG Engine.
export class SemanticAbilityProvider {
  async proposeAbilityDefinition() {
    throw new Error("Semantic ability providers are not implemented in v0.4.");
  }
}
