import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { compileAbilityRegistry, AbilityCompilationCache } from "../ability-parser/index.js";
import { abilityAliasEntries, compileSemanticDictionary } from "../semantic-input/index.js";
import { canonicalHash, deepClone, deepFreeze } from "../utils.js";
import { extensionError } from "./errors.js";
import { validateExtensionManifest } from "./schemas.js";

export const EXTENSION_SDK_VERSION = "0.7.0";
const PRESENTATION = new Set(["name", "description", "flavor", "author", "authors", "notes", "metadata"]);

function stripPresentation(value) {
  if (Array.isArray(value)) return value.map(stripPresentation);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRESENTATION.has(key)).map(([key, child]) => [key, stripPresentation(child)]));
}

function compatible(actual, expected) {
  if (expected === actual || expected === "*") return true;
  if (expected.startsWith("^")) return actual.split(".")[0] === expected.slice(1).split(".")[0] && Number(actual.split(".")[0]) >= Number(expected.slice(1).split(".")[0]);
  return false;
}

function assertNamespaced(id, namespace, path) {
  if (typeof id !== "string" || !(id === namespace || id.startsWith(`${namespace}.`) || id.startsWith(`${namespace}:`))) throw extensionError("EXTENSION_NAMESPACE_ERROR", `${id} is outside namespace ${namespace}.`, path);
}

function normalizeRegistries(registries = {}) {
  return Object.fromEntries(Object.entries(registries).sort(([a], [b]) => a.localeCompare(b)).map(([kind, entries]) => [kind, Object.fromEntries(Object.entries(entries ?? {}).sort(([a], [b]) => a.localeCompare(b)))]));
}

function validateContent(input) {
  const { manifest } = input;
  validateExtensionManifest(manifest);
  if (!compatible(EXTENSION_SDK_VERSION, manifest.sdk_version)) throw extensionError("EXTENSION_COMPATIBILITY_ERROR", `SDK ${EXTENSION_SDK_VERSION} is incompatible with ${manifest.sdk_version}.`, "sdk_version");
  for (const [kind, entries] of Object.entries(input.registries ?? {})) for (const id of Object.keys(entries)) assertNamespaced(id, manifest.namespace, `registries.${kind}.${id}`);
  for (const ability of input.abilities ?? []) assertNamespaced(ability.ability_id, manifest.namespace, `abilities.${ability.ability_id}`);
  for (const alias of Object.keys(input.scaling?.stat_aliases ?? {})) assertNamespaced(alias, manifest.namespace, `scaling.stat_aliases.${alias}`);
  return true;
}

function dependencyOrder(packages) {
  const byId = new Map(packages.map((item) => [item.manifest.extension_id, item]));
  const visiting = new Set(); const visited = new Set(); const ordered = [];
  function visit(item) {
    const id = item.manifest.extension_id;
    if (visiting.has(id)) throw extensionError("EXTENSION_DEPENDENCY_CYCLE", `Dependency cycle includes ${id}.`, id);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of [...item.manifest.dependencies].sort((a, b) => a.extension_id.localeCompare(b.extension_id))) {
      const found = byId.get(dep.extension_id);
      if (!found) throw extensionError("EXTENSION_DEPENDENCY_MISSING", `Missing dependency ${dep.extension_id}.`, id);
      if (!compatible(found.manifest.version, dep.version)) throw extensionError("EXTENSION_DEPENDENCY_VERSION", `${dep.extension_id} ${found.manifest.version} does not satisfy ${dep.version}.`, id);
      visit(found);
    }
    visiting.delete(id); visited.add(id); ordered.push(item);
  }
  for (const item of [...packages].sort((a, b) => a.manifest.extension_id.localeCompare(b.manifest.extension_id))) visit(item);
  return ordered;
}

function composeRegistries(packages, base = {}) {
  const result = normalizeRegistries(base);
  for (const input of packages) for (const [kind, entries] of Object.entries(normalizeRegistries(input.registries ?? {}))) {
    result[kind] ??= {};
    for (const [id, value] of Object.entries(entries)) {
      if (Object.hasOwn(result[kind], id)) throw extensionError("EXTENSION_REGISTRY_COLLISION", `Registry collision at ${kind}.${id}.`, `${kind}.${id}`);
      result[kind][id] = deepClone(value);
    }
  }
  return result;
}

export function compileExtensionPackages(inputs, context = {}, options = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw extensionError("EXTENSION_COMPILATION_ERROR", "At least one extension package is required.", "inputs");
  for (const input of inputs) validateContent(input);
  const ordered = dependencyOrder(inputs);
  const registries = composeRegistries(ordered, context.registries ?? {});
  const stats = new Set(context.stats ?? []);
  const resources = new Set(context.resources ?? []);
  const statuses = new Set(context.statuses ?? Object.keys(registries.status_definitions ?? {}));
  const defenses = new Set(context.defenses ?? Object.keys(registries.defense_sources ?? {}));
  for (const input of ordered) {
    for (const coreStat of Object.values(input.scaling?.stat_aliases ?? {})) {
      if (!stats.has(coreStat)) throw extensionError("EXTENSION_REFERENCE_ERROR", `Stat alias targets unknown core stat ${coreStat}.`, "scaling.stat_aliases");
    }
    for (const id of Object.keys(input.registries?.resources ?? {})) resources.add(id);
    for (const id of Object.keys(input.registries?.status_definitions ?? {})) statuses.add(id);
    for (const id of Object.keys(input.registries?.defense_sources ?? {})) defenses.add(id);
  }
  const abilityCache = options.abilityCache ?? new AbilityCompilationCache();
  const definitions = ordered.flatMap((item) => item.abilities ?? []);
  const abilityRegistry = compileAbilityRegistry(definitions, { rulesetVersion: context.rulesetVersion ?? ordered[0].manifest.ruleset_version, stats: [...stats], resources: [...resources], statuses: [...statuses], defenses: [...defenses], registries }, { cache: abilityCache });
  const semanticEntries = ordered.flatMap((item) => item.semantics ?? []).concat(abilityAliasEntries(abilityRegistry));
  const locales = [...new Set(semanticEntries.map((entry) => entry.locale))].sort();
  const semanticDictionaries = Object.fromEntries(locales.map((locale) => [locale, compileSemanticDictionary(semanticEntries, { locale, extensionHashes: Object.fromEntries(ordered.map((item) => [item.manifest.extension_id, canonicalHash(stripPresentation(item))])) })]));
  const mechanicalInput = ordered.map((item) => stripPresentation(item));
  const mechanicalHash = canonicalHash({ sdk: EXTENSION_SDK_VERSION, packages: mechanicalInput, registries, abilities: abilityRegistry.hash, semantics: Object.fromEntries(locales.map((locale) => [locale, semanticDictionaries[locale].hash])) });
  const provenanceHash = canonicalHash({ sdk: EXTENSION_SDK_VERSION, packages: ordered });
  const diagnostics = {
    packages: ordered.length, abilities: abilityRegistry.size, semantic_entries: semanticEntries.length,
    registry_entries: Object.values(registries).reduce((sum, registry) => sum + Object.keys(registry).length, 0),
    aliases: ordered.reduce((sum, item) => sum + Object.keys(item.scaling?.stat_aliases ?? {}).length, 0), warnings: []
  };
  return deepFreeze({ sdk_version: EXTENSION_SDK_VERSION, ruleset_version: context.rulesetVersion ?? ordered[0].manifest.ruleset_version, package_order: ordered.map((item) => item.manifest.extension_id), manifests: ordered.map((item) => deepClone(item.manifest)), registries, scaling_profiles: ordered.map((item) => deepClone(item.scaling ?? {})), content: ordered.map((item) => deepClone(item.content ?? {})), advanced_mechanics: ordered.map((item) => deepClone(item.advanced_mechanics ?? {})), scenarios: ordered.map((item) => deepClone(item.scenarios ?? {})), ability_registry: abilityRegistry, semantic_dictionaries: semanticDictionaries, mechanical_hash: mechanicalHash, provenance_hash: provenanceHash, diagnostics });
}

async function readData(path) {
  const text = await readFile(path, "utf8");
  return [".yaml", ".yml"].includes(extname(path).toLowerCase()) ? parseYaml(text, { uniqueKeys: true }) : JSON.parse(text);
}

function safePath(directory, relative) {
  const target = resolve(directory, relative);
  const root = `${resolve(directory)}${sep}`;
  if (!target.startsWith(root)) throw extensionError("EXTENSION_PATH_ERROR", `Extension file escapes package root: ${relative}.`, relative);
  return target;
}

export async function readExtensionPackage(directory) {
  const manifest = await readData(join(directory, "extension.json"));
  validateExtensionManifest(manifest);
  const result = { manifest, registries: {}, abilities: [], semantics: [], scaling: {}, content: {}, advanced_mechanics: {}, scenarios: {} };
  for (const [kind, relative] of Object.entries(manifest.files)) result[kind] = await readData(safePath(directory, relative));
  return deepFreeze(result);
}

export async function loadExtensionPackage(directory, context = {}, options = {}) {
  return compileExtensionPackages([await readExtensionPackage(directory)], context, options);
}
