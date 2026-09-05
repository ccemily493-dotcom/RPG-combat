import { evaluatePredicate } from "../modifiers.js";
import { canonicalHash, deepClone, deepFreeze, getPath } from "../utils.js";
import { evaluateExpression, isExpression, validateExpression, walkExpressions } from "./expression.js";
import { parserError } from "./errors.js";
import { validateSchema } from "./schemas.js";

export const ABILITY_PARSER_VERSION = "0.4.0";
const PRESENTATION_FIELDS = new Set(["name", "description", "flavor", "author_notes", "metadata"]);
const FORBIDDEN_OUTCOME_KEYS = new Set(["final_damage", "hit_outcome", "defense_result", "status_applied", "incapacitated", "final_resource_state", "final_world_state", "state_delta"]);

function defaultContext(context = {}) {
  const registries = context.registries ?? {};
  const registryHashes = context.registryHashes ?? Object.fromEntries(Object.entries(registries).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonicalHash(value)]));
  return {
    rulesetVersion: context.rulesetVersion ?? "0.3",
    stats: new Set(context.stats ?? []),
    resources: new Set(context.resources ?? []),
    statuses: new Set(context.statuses ?? Object.keys(registries.status_definitions ?? {})),
    defenses: new Set(context.defenses ?? Object.keys(registries.defense_sources ?? {})),
    registryHashes,
    maxDepth: context.maxDepth ?? 16,
    maxNodes: context.maxNodes ?? 128
  };
}

function normalizeDefinition(definition) {
  const value = deepClone(definition);
  value.tags ??= [];
  value.parameters ??= {};
  value.constants ??= {};
  value.requirements ??= [];
  value.limitations ??= [];
  value.resources ??= [];
  value.variants ??= {};
  value.cooldown ??= null;
  value.mechanics.strategy_fragments ??= [];
  value.metadata ??= {};
  return value;
}

function assertNamespace(definition) {
  if (!definition.ability_id.startsWith(`${definition.namespace}.`)) {
    throw parserError("COMPATIBILITY_ERROR", `Ability ${definition.ability_id} is outside namespace ${definition.namespace}.`, "ability_id");
  }
}

function assertNoOutcomes(value, path = "definition") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_OUTCOME_KEYS.has(key)) throw parserError("COMPILATION_ERROR", `Ability definitions cannot declare engine outcome field ${key}.`, `${path}.${key}`);
    assertNoOutcomes(child, `${path}.${key}`);
  }
}

function assertRequirementReferences(requirements, context, path) {
  for (const [index, item] of requirements.entries()) {
    const at = `${path}[${index}].ref`;
    if (item.type === "MIN_STAT" && !context.stats.has(item.ref)) throw parserError("REFERENCE_ERROR", `Unknown stat ${item.ref}.`, at);
    if (item.type === "REQUIRED_RESOURCE" && !context.resources.has(item.ref)) throw parserError("REFERENCE_ERROR", `Unknown resource ${item.ref}.`, at);
    if (["REQUIRED_STATUS", "FORBIDDEN_STATUS"].includes(item.type) && !context.statuses.has(item.ref)) throw parserError("REFERENCE_ERROR", `Unknown status ${item.ref}.`, at);
  }
}

function referenceAllowed(ref, definition, context) {
  const parts = ref.split(".");
  if (parts[0] === "parameters") return parts.length === 2 && Object.hasOwn(definition.parameters, parts[1]);
  if (parts[0] === "constants") return parts.length === 2 && Object.hasOwn(definition.constants, parts[1]);
  if (parts[0] === "context") return ["distance", "target_count", "current_turn"].includes(parts[1]) && parts.length === 2;
  if (parts[0] === "actor" && parts[1] === "stats") return parts.length === 3 && context.stats.has(parts[2]);
  if (parts[0] === "actor" && parts[1] === "resources") return parts.length === 4 && context.resources.has(parts[2]) && ["current", "maximum"].includes(parts[3]);
  return false;
}

function inspectComponentReferences(component, context, path) {
  const action = component.output.action;
  for (const [index, cost] of (action?.costs ?? []).entries()) {
    if (typeof cost.resource === "string" && !context.resources.has(cost.resource)) throw parserError("REFERENCE_ERROR", `Unknown resource ${cost.resource}.`, `${path}.output.action.costs[${index}].resource`);
  }
  for (const [index, status] of (action?.attack?.status_effects ?? []).entries()) {
    if (typeof status.status_id === "string" && !context.statuses.has(status.status_id)) throw parserError("REFERENCE_ERROR", `Unknown status ${status.status_id}.`, `${path}.output.action.attack.status_effects[${index}].status_id`);
  }
  if (action?.defense?.source_ref && !context.defenses.has(action.defense.source_ref)) throw parserError("REFERENCE_ERROR", `Unknown defense source ${action.defense.source_ref}.`, `${path}.output.action.defense.source_ref`);
  if (component.output.reaction?.source_ref && !context.defenses.has(component.output.reaction.source_ref)) throw parserError("REFERENCE_ERROR", `Unknown defense source ${component.output.reaction.source_ref}.`, `${path}.output.reaction.source_ref`);
}

function assertTemplateContract(component, path) {
  const actionTemplates = new Set(["ATTACK", "DEFENSE", "MOVEMENT", "STATUS_ATTEMPT", "RESOURCE_TRANSFER", "RESOURCE_DENIAL", "MODIFIER_APPLICATION", "AREA_EFFECT"]);
  if (actionTemplates.has(component.template) && !component.output?.action) throw parserError("COMPILATION_ERROR", `${component.template} requires output.action.`, `${path}.output.action`);
  if (component.template === "REACTION" && !component.output?.reaction) throw parserError("COMPILATION_ERROR", "REACTION requires output.reaction.", `${path}.output.reaction`);
  if (component.template === "TEMPORAL_EFFECT" && !component.output?.temporal_effect && !component.output?.effects?.length) throw parserError("COMPILATION_ERROR", "TEMPORAL_EFFECT requires output.temporal_effect or a non-empty output.effects array.", `${path}.output`);
  if (component.template === "RELATIONAL_EFFECT" && !component.output?.relation) throw parserError("COMPILATION_ERROR", "RELATIONAL_EFFECT requires output.relation.", `${path}.output.relation`);
  if (component.template === "STRATEGY_FRAGMENT" && !component.output?.strategy) throw parserError("COMPILATION_ERROR", "STRATEGY_FRAGMENT requires output.strategy.", `${path}.output.strategy`);
}

function compileComponent(component, definition, context, index) {
  const path = `mechanics.components[${index}]`;
  assertTemplateContract(component, path);
  inspectComponentReferences(component, context, path);
  let nodes = 0;
  let depth = 0;
  const references = new Set();
  const output = walkExpressions(component.output, (expression, expressionPath) => {
    const metrics = validateExpression(expression, {
      maxDepth: context.maxDepth,
      maxNodes: context.maxNodes,
      path: `${path}.output.${expressionPath}`,
      referenceAllowed: (ref) => referenceAllowed(ref, definition, context)
    });
    nodes += metrics.nodes;
    depth = Math.max(depth, metrics.depth);
    for (const ref of metrics.references) references.add(ref);
    if (nodes > context.maxNodes) throw parserError("EXPRESSION_ERROR", `Component exceeds ${context.maxNodes} expression nodes.`, path);
    return deepClone(expression);
  });
  return {
    id: component.id,
    template: component.template,
    execution_class: component.execution_class ?? null,
    when: component.when ? deepClone(component.when) : null,
    output,
    expression_metrics: { nodes, depth, references: [...references].sort() }
  };
}

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return deepClone(override);
  const result = base && typeof base === "object" && !Array.isArray(base) ? deepClone(base) : {};
  for (const [key, value] of Object.entries(override)) result[key] = value && typeof value === "object" && !Array.isArray(value) ? deepMerge(result[key], value) : deepClone(value);
  return result;
}

function compileVariants(definition, context, componentIds) {
  const variants = {};
  for (const [variantId, variant] of Object.entries(definition.variants).sort(([a], [b]) => a.localeCompare(b))) {
    for (const key of Object.keys(variant.constant_overrides ?? {})) if (!Object.hasOwn(definition.constants, key)) throw parserError("REFERENCE_ERROR", `Variant ${variantId} overrides unknown constant ${key}.`, `variants.${variantId}`);
    for (const key of Object.keys(variant.component_overrides ?? {})) if (!componentIds.has(key)) throw parserError("REFERENCE_ERROR", `Variant ${variantId} overrides unknown component ${key}.`, `variants.${variantId}`);
    const normalized = deepClone(variant);
    normalized.constant_overrides ??= {};
    normalized.component_overrides ??= {};
    walkExpressions(normalized, (expression, path) => {
      validateExpression(expression, { maxDepth: context.maxDepth, maxNodes: context.maxNodes, path: `variants.${variantId}.${path}`, referenceAllowed: (ref) => referenceAllowed(ref, definition, context) });
      return expression;
    });
    variants[variantId] = normalized;
  }
  return variants;
}

function diagnosticFindings(components) {
  const findings = [];
  for (const component of components) {
    const attack = component.output.action?.attack;
    for (const [field, threshold] of [["power", 300], ["range", 1000], ["quantity", 500]]) {
      if (Number.isFinite(attack?.[field]) && attack[field] > threshold) findings.push({ code: `SUSPICIOUS_${field.toUpperCase()}`, severity: "warning", nonBlocking: true, component_id: component.id, value: attack[field], threshold });
    }
  }
  return findings;
}

function mechanicalDefinition(definition) {
  return Object.fromEntries(Object.entries(definition).filter(([key]) => !PRESENTATION_FIELDS.has(key)));
}

export function validateAbilityDefinition(definition) {
  validateSchema("definition", definition);
  assertNamespace(definition);
  assertNoOutcomes(definition);
  return true;
}

export function validateCompiledAbility(compiled) {
  validateSchema("compiled", compiled);
  assertNoOutcomes(compiled, "compiled");
  return true;
}

export function compileAbilityDefinition(definition, suppliedContext = {}) {
  validateAbilityDefinition(definition);
  const normalized = normalizeDefinition(definition);
  const context = defaultContext(suppliedContext);
  assertRequirementReferences(normalized.requirements, context, "requirements");
  assertRequirementReferences(normalized.limitations, context, "limitations");
  for (const resource of normalized.resources) if (!context.resources.has(resource)) throw parserError("REFERENCE_ERROR", `Unknown resource ${resource}.`, "resources");
  for (const component of normalized.mechanics.components) if (component.output?.defense_source?.id) context.defenses.add(component.output.defense_source.id);
  const componentIds = new Set();
  const components = normalized.mechanics.components.map((component, index) => {
    if (componentIds.has(component.id)) throw parserError("COMPILATION_ERROR", `Duplicate component id ${component.id}.`, `mechanics.components[${index}].id`);
    componentIds.add(component.id);
    return compileComponent(component, normalized, context, index);
  });
  const variants = compileVariants(normalized, context, componentIds);
  const mechanical = mechanicalDefinition(normalized);
  const compiled = {
    ability_id: normalized.ability_id,
    ability_version: normalized.version,
    namespace: normalized.namespace,
    parser_version: ABILITY_PARSER_VERSION,
    ruleset_version: context.rulesetVersion,
    definition_hash: canonicalHash(normalized),
    mechanical_hash: canonicalHash(mechanical),
    registry_hashes: Object.fromEntries(Object.entries(context.registryHashes).sort(([a], [b]) => a.localeCompare(b))),
    parameters: deepClone(normalized.parameters),
    constants: deepClone(normalized.constants),
    requirements: deepClone(normalized.requirements),
    limitations: deepClone(normalized.limitations),
    cooldown: deepClone(normalized.cooldown),
    variants,
    components,
    strategy_fragments: deepClone(normalized.mechanics.strategy_fragments),
    diagnostics: diagnosticFindings(components)
  };
  validateCompiledAbility(compiled);
  return deepFreeze(compiled);
}

function validateParameter(name, definition, value) {
  const type = definition.type;
  const valid = type === "number" ? Number.isFinite(value)
    : type === "integer" ? Number.isInteger(value)
      : type === "boolean" ? typeof value === "boolean"
        : type === "string" ? typeof value === "string"
          : definition.values?.includes(value);
  if (!valid) throw parserError("PARAMETER_ERROR", `Invalid value for parameter ${name}.`, `parameters.${name}`);
  if (typeof value === "number" && (value < (definition.minimum ?? -Infinity) || value > (definition.maximum ?? Infinity))) throw parserError("PARAMETER_ERROR", `Parameter ${name} is outside its bounds.`, `parameters.${name}`);
  return value;
}

function bindParameters(compiled, supplied = {}) {
  for (const name of Object.keys(supplied)) if (!Object.hasOwn(compiled.parameters, name)) throw parserError("PARAMETER_ERROR", `Unknown parameter ${name}.`, `parameters.${name}`);
  const bound = {};
  for (const [name, definition] of Object.entries(compiled.parameters)) {
    const value = Object.hasOwn(supplied, name) ? supplied[name] : definition.default;
    if (value === undefined) throw parserError("PARAMETER_ERROR", `Missing required parameter ${name}.`, `parameters.${name}`);
    bound[name] = validateParameter(name, definition, value);
  }
  return bound;
}

function expressionBindings(actor, parameters, constants, use, runtime) {
  return {
    actor: { stats: actor?.resolved_stats ?? {}, resources: actor?.resources ?? {} },
    parameters,
    constants,
    context: {
      distance: runtime.distance ?? 0,
      target_count: use.targets.length,
      current_turn: use.declared_options?.turn ?? runtime.world?.turn ?? 0
    }
  };
}

function materialize(value, bindings) {
  return walkExpressions(value, (expression, path) => evaluateExpression(expression, bindings, path));
}

function bindIdentifiers(value, use, prefix) {
  if (value === "$actor") return use.actor_id;
  if (value === "$target_action") return use.declared_options?.target_action_id ?? null;
  if (typeof value === "string" && value.startsWith("$target.")) {
    const index = Number(value.slice("$target.".length));
    return use.targets[index]?.ref ?? null;
  }
  if (typeof value === "string" && value.startsWith("$action.")) return `${prefix}:${value.slice("$action.".length)}`;
  if (Array.isArray(value)) return value.map((item) => bindIdentifiers(item, use, prefix));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bindIdentifiers(item, use, prefix)]));
  return value;
}

function componentOutput(compiled, component, variant, bindings, use, prefix) {
  const override = variant?.component_overrides?.[component.id] ?? {};
  return bindIdentifiers(materialize(deepMerge(component.output, override), bindings), use, prefix);
}

function provenance(compiled, parameters, variant) {
  return { ability_id: compiled.ability_id, ability_version: compiled.ability_version, compiled_hash: compiled.mechanical_hash, parser_version: compiled.parser_version, parameter_bindings: deepClone(parameters), variant: variant ?? null };
}

function normalizedAction(compiled, component, output, use, parameters, turn, prefix) {
  const template = deepClone(output.action);
  if (!template) throw parserError("INSTANTIATION_ERROR", `${component.template} component ${component.id} requires output.action.`, `components.${component.id}`);
  const action = {
    ...template,
    id: `${prefix}:${component.id}`,
    turn,
    actor_id: use.actor_id,
    phase: "declared",
    targets: deepClone(template.targets ?? use.targets),
    costs: deepClone(template.costs ?? []),
    modifiers: deepClone(template.modifiers ?? []),
    tags: [...new Set(template.tags ?? [])].sort(),
    depends_on: deepClone(template.depends_on ?? []),
    effects: deepClone(template.effects ?? { displacements: [], status_removals: [] }),
    cooldown: deepClone(template.cooldown ?? compiled.cooldown),
    parser_trace: null,
    resolution: null,
    extension_payload: { ...(template.extension_payload ?? {}), "ability:provenance": provenance(compiled, parameters, use.declared_options?.variant) }
  };
  if (component.execution_class && component.execution_class !== "ZERO_TIME") action.economy_class = component.execution_class;
  validateSchema("action", action);
  return action;
}

export function instantiateAbilityUse(compiled, use, runtime = {}) {
  validateCompiledAbility(compiled);
  validateSchema("use", use);
  if (use.ability_id !== compiled.ability_id) throw parserError("INSTANTIATION_ERROR", `Use references ${use.ability_id}, expected ${compiled.ability_id}.`, "ability_id");
  const actor = runtime.actor ?? runtime.characters?.[use.actor_id];
  if (!actor) throw parserError("INSTANTIATION_ERROR", `Unknown actor ${use.actor_id}.`, "actor_id");
  if (runtime.characters) {
    for (const [index, target] of use.targets.entries()) {
      if (target.type === "character" && !runtime.characters[target.ref]) throw parserError("REFERENCE_ERROR", `Unknown target ${target.ref}.`, `targets[${index}].ref`);
    }
  }
  const parameters = bindParameters(compiled, use.parameters ?? {});
  const variantId = use.declared_options?.variant;
  const variant = variantId ? compiled.variants[variantId] : null;
  if (variantId && !variant) throw parserError("PARAMETER_ERROR", `Unknown variant ${variantId}.`, "declared_options.variant");
  const constants = { ...deepClone(compiled.constants), ...(variant?.constant_overrides ?? {}) };
  const bindings = expressionBindings(actor, parameters, constants, use, runtime);
  const turn = use.declared_options?.turn ?? runtime.world?.turn ?? 0;
  const prefix = use.declared_options?.action_id_prefix ?? `${compiled.ability_id}:${use.actor_id}:${turn}`;
  const output = { actions: [], reactions: [], defense_sources: [], temporal_effects: [], relations: [], opportunities: [], strategy_fragments: [], requirements: deepClone(compiled.requirements), limitations: deepClone(compiled.limitations) };
  const instantiated = [];
  for (const component of [...compiled.components].sort((a, b) => a.id.localeCompare(b.id))) {
    if (component.when && !evaluatePredicate(component.when, bindings)) continue;
    const value = componentOutput(compiled, component, variant, bindings, use, prefix);
    if (["ATTACK", "DEFENSE", "MOVEMENT", "STATUS_ATTEMPT", "RESOURCE_TRANSFER", "RESOURCE_DENIAL", "MODIFIER_APPLICATION", "AREA_EFFECT"].includes(component.template)) output.actions.push(normalizedAction(compiled, component, value, use, parameters, turn, prefix));
    else if (component.template === "REACTION") {
      validateSchema("reaction", value.reaction);
      output.reactions.push(value.reaction);
    }
    else if (component.template === "TEMPORAL_EFFECT") {
      const effects = value.effects ?? [value.temporal_effect];
      for (const effect of effects) validateSchema("temporalEffect", effect);
      output.temporal_effects.push(...effects);
    }
    else if (component.template === "RELATIONAL_EFFECT") {
      validateSchema("relation", value.relation);
      output.relations.push(value.relation);
    }
    else if (component.template === "STRATEGY_FRAGMENT") {
      validateSchema("strategy", value.strategy);
      output.strategy_fragments.push(value.strategy);
    }
    if (component.template !== "TEMPORAL_EFFECT" && Array.isArray(value.effects)) {
      for (const effect of value.effects) validateSchema("temporalEffect", effect);
      output.temporal_effects.push(...value.effects);
    }
    if (value.defense_source) {
      validateSchema("defenseSources", { [value.defense_source.id]: value.defense_source.definition });
      output.defense_sources.push(value.defense_source);
    }
    if (value.opportunity) {
      validateSchema("opportunity", value.opportunity);
      output.opportunities.push(value.opportunity);
    }
    instantiated.push({ component_id: component.id, template: component.template });
  }
  output.actions.sort((a, b) => a.id.localeCompare(b.id));
  output.metadata = { provenance: provenance(compiled, parameters, variantId), normalized_payload_hash: canonicalHash({ ...output, metadata: undefined }) };
  if (runtime.trace) output.trace = { parser_version: compiled.parser_version, stages: ["ability_lookup", "parameters_validated", "bindings_resolved", "expressions_evaluated", "templates_instantiated", "normalized_payload_validated"], components: instantiated };
  return deepFreeze(output);
}

export function inspectAbility(compiled) {
  validateCompiledAbility(compiled);
  return deepFreeze({
    ability_id: compiled.ability_id,
    mechanical_hash: compiled.mechanical_hash,
    definition_hash: compiled.definition_hash,
    component_count: compiled.components.length,
    templates: Object.fromEntries([...new Set(compiled.components.map((item) => item.template))].sort().map((name) => [name, compiled.components.filter((item) => item.template === name).length])),
    parameter_count: Object.keys(compiled.parameters).length,
    expression_nodes: compiled.components.reduce((sum, item) => sum + item.expression_metrics.nodes, 0),
    strategy_fragment_count: compiled.strategy_fragments.length + compiled.components.filter((item) => item.template === "STRATEGY_FRAGMENT").length,
    diagnostics: deepClone(compiled.diagnostics)
  });
}

export function traceAbilityCompilation(definition, context = {}) {
  const compiled = compileAbilityDefinition(definition, context);
  return deepFreeze({ compiled, trace: { parser_version: ABILITY_PARSER_VERSION, stages: ["definition_validation", "references_resolved", "requirements_compiled", "expressions_compiled", "templates_compiled", "strategy_fragments_validated", "compiled_hash"], compiled_hash: compiled.mechanical_hash } });
}
