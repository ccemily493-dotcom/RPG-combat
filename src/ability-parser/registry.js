import { canonicalHash, deepClone, deepFreeze } from "../utils.js";
import { compileAbilityDefinition, validateCompiledAbility } from "./compiler.js";
import { parserError } from "./errors.js";

export class AbilityCompilationCache {
  #entries = new Map();
  #hits = 0;
  #misses = 0;

  key(definition, context = {}) {
    return canonicalHash({
      definition,
      parser_version: "0.4.0",
      ruleset_version: context.rulesetVersion ?? "0.3",
      registry_hashes: context.registryHashes ?? Object.fromEntries(Object.entries(context.registries ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, registry]) => [id, canonicalHash(registry)]))
    });
  }

  compile(definition, context = {}) {
    const key = this.key(definition, context);
    if (this.#entries.has(key)) {
      this.#hits += 1;
      return this.#entries.get(key);
    }
    this.#misses += 1;
    const compiled = compileAbilityDefinition(definition, context);
    this.#entries.set(key, compiled);
    return compiled;
  }

  clear() {
    this.#entries.clear();
    this.#hits = 0;
    this.#misses = 0;
  }

  stats() {
    return Object.freeze({ size: this.#entries.size, hits: this.#hits, misses: this.#misses });
  }
}

export function compileAbilityRegistry(definitions, context = {}, options = {}) {
  if (!Array.isArray(definitions)) throw parserError("REGISTRY_ERROR", "Ability registry input must be an array.", "definitions");
  const cache = options.cache ?? null;
  const compiled = new Map();
  for (const definition of [...definitions].sort((a, b) => String(a.ability_id).localeCompare(String(b.ability_id)))) {
    if (compiled.has(definition.ability_id)) throw parserError("REGISTRY_ERROR", `Duplicate ability id ${definition.ability_id}.`, definition.ability_id);
    const artifact = cache ? cache.compile(definition, context) : compileAbilityDefinition(definition, context);
    validateCompiledAbility(artifact);
    if (artifact.ruleset_version !== (context.rulesetVersion ?? "0.3")) throw parserError("COMPATIBILITY_ERROR", `Ability ${artifact.ability_id} targets incompatible ruleset ${artifact.ruleset_version}.`, artifact.ability_id);
    compiled.set(artifact.ability_id, artifact);
  }
  const canonical = [...compiled.values()].map((ability) => ({ id: ability.ability_id, version: ability.ability_version, hash: ability.mechanical_hash }));
  const registryHash = canonicalHash(canonical);
  return deepFreeze({
    version: "0.4.0",
    hash: registryHash,
    size: compiled.size,
    ids: Object.freeze([...compiled.keys()]),
    get(id) {
      const ability = compiled.get(id);
      if (!ability) throw parserError("REGISTRY_ERROR", `Unknown ability ${id}.`, id);
      return ability;
    },
    has(id) { return compiled.has(id); },
    values() { return Object.freeze([...compiled.values()]); },
    snapshot() { return deepFreeze({ version: "0.4.0", hash: registryHash, abilities: deepClone([...compiled.values()]) }); }
  });
}
