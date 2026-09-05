import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalHash, stableStringify } from "../src/utils.js";
import { buildGenericAbilityDefinitions } from "../src/ability-parser/fixtures.js";
import { compileAbilityRegistry, instantiateAbilityUse } from "../src/ability-parser/index.js";
import {
  CandidateLearningStore, DeterministicMockFallbackProvider, SemanticDictionaryCompilationCache, SemanticParseCache,
  compileSemanticDictionary, compileSemanticIntent, englishEntries, inspectSemanticParse, loadSemanticConfig,
  normalizeSemanticText, parseSemanticInput, spanishEntries, summarizeSemanticParses, validateSemanticIntent
} from "../src/semantic-input/index.js";
import { buildSemanticActionTemplates, buildSemanticDictionaryEntries, semanticEntities } from "../src/semantic-input/fixtures.js";
import { loadScenarioFixture, loadSessionScenarioFixture, clone } from "./helpers.js";

const { engine, scenarios } = await loadScenarioFixture();
const { scenarios: sessionScenarios } = await loadSessionScenarioFixture();
const scenario = scenarios.A;
const abilityContext = { rulesetVersion: engine.config.version, stats: Object.keys(engine.config.specs["stats.yaml"].stats), resources: Object.keys(scenario.characters.a.resources), registries: scenario.registries };
const abilityRegistry = compileAbilityRegistry(buildGenericAbilityDefinitions(), abilityContext);
const semanticConfig = await loadSemanticConfig();
const esDictionary = compileSemanticDictionary(buildSemanticDictionaryEntries(abilityRegistry), { locale: "es" });
const enDictionary = compileSemanticDictionary(buildSemanticDictionaryEntries(abilityRegistry), { locale: "en" });
const baseContext = { actorId: "a", entities: semanticEntities(), defaultTargets: ["b"], focus: ["b"], abilityRegistry, world: scenario.world, characters: scenario.characters, actionTemplates: buildSemanticActionTemplates(scenario.actions[0]), distances: { b: 2, c: 4 }, spatialLabels: { left: ["b"] } };

async function parse(text, locale = "es", extra = {}) {
  return parseSemanticInput(text, { dictionary: locale === "es" ? esDictionary : enDictionary, config: semanticConfig, locale, context: { ...baseContext, locale, ...extra } });
}

function fallbackIntent(text, action = { type: "ATTACK", subtype: "PUNCH", targets: [{ entity_id: "b", source_span: null }], target_zone: null, direction: null, distance: null, intensity: null, quantity: 1, object_ref: null, execution_class: "ACTION", primitive: null }) {
  return { intent_type: "ACTION", action, confidence: { intent_type: 0.8, action: 0.8, target: 0.8 } };
}

test("text normalization preserves original text, Unicode matching, and source offsets", () => {
  const value = normalizeSemanticText("  ¡PÉGO!!  ", { locale: "es" });
  assert.equal(value.original_text, "  ¡PÉGO!!  ");
  assert.equal(value.normalized_text, "pégo");
  assert.equal(value.matching_text, "pego");
  assert.deepEqual(value.tokens[0], { text: "pégo", match: "pego", start: 3, end: 7 });
});

test("Scenarios A-D: Spanish attack, kick, retreat, and dodge parse on the rule path", async () => {
  const a = await parse("le pego"); const b = await parse("le doy una patada"); const c = await parse("me alejo"); const d = await parse("esquivo");
  assert.equal(a.intent.action.type, "ATTACK"); assert.equal(a.intent.action.subtype, "PUNCH");
  assert.equal(b.intent.action.subtype, "KICK"); assert.equal(c.intent.action.type, "RETREAT"); assert.equal(d.intent.action.type, "DODGE");
  for (const result of [a, b, c, d]) assert.equal(result.intent.provenance.parser_path, "RULE");
});

test("Scenarios E-G: ability aliases, sequences, and setup/payoff text stay structural", async () => {
  const ability = await parse("uso Heavy Strike contra B");
  const sequence = await parse("corro hacia B y lo golpeo");
  const strategy = await parse("tiro algo a su izquierda para distraerlo y me muevo detrás");
  assert.equal(ability.intent.ability_use.ability_id, "core.example.heavy_strike");
  assert.equal(sequence.intent.intent_type, "SEQUENCE"); assert.deepEqual(sequence.intent.sequence.map((step) => step.action.type), ["RUN", "ATTACK"]);
  assert.equal(strategy.intent.intent_type, "STRATEGY"); assert.deepEqual(strategy.intent.strategy.steps.map((step) => step.primitive ?? step.action.type), ["THROW", "DISTRACTION", "REPOSITION"]);
  assert.equal(Object.hasOwn(strategy.intent, "success"), false);
});

test("Scenarios H-J: body zone, multi-target binding, and quantity are extracted", async () => {
  const zone = await parse("le doy una patada en la pierna");
  const multi = await parse("ataco a B y C", "es", { defaultTargets: [], focus: [] });
  const quantity = await parse("disparo cinco veces");
  assert.equal(zone.intent.action.target_zone, "LEG");
  assert.deepEqual(multi.intent.action.targets.map((target) => target.entity_id), ["b", "c"]);
  assert.equal(quantity.intent.action.quantity, 5);
});

test("distance and self-correction preserve the final explicit player reference", async () => {
  const movement = await parse("me alejo 2,5 metros");
  const corrected = await parse("ataco a B, no, a C", "es", { defaultTargets: [], focus: [] });
  assert.equal(movement.intent.action.distance, 2.5);
  assert.deepEqual(corrected.intent.action.targets.map((target) => target.entity_id), ["c"]);
});

test("Scenarios K-O: negation, ambiguity, unknowns, English, and synonyms behave conservatively", async () => {
  const negated = await parse("no lo ataco");
  const ambiguous = await parse("ataco al enemigo", "es", { defaultTargets: [], focus: [] });
  const unknown = await parse("hago una cosa indescriptible", "es", { defaultTargets: [], focus: [] });
  const english = await parse("kick him", "en");
  const synonyms = await Promise.all(["le pego", "golpeo", "le meto un golpe"].map((text) => parse(text)));
  assert.equal(negated.intent.intent_type, "WAIT"); assert.equal(negated.intent.action, undefined);
  assert.equal(ambiguous.status, "NEEDS_DISAMBIGUATION"); assert.deepEqual(ambiguous.ambiguities[0].candidates, ["b", "c"]);
  assert.equal(unknown.status, "UNRESOLVED"); assert.equal(english.intent.action.subtype, "KICK");
  assert.deepEqual(synonyms.map((result) => ({ type: result.intent.action.type, subtype: result.intent.action.subtype })), Array(3).fill({ type: "ATTACK", subtype: "PUNCH" }));
});

test("entity scenarios X-AB resolve only unique references and never choose a tactical target", async () => {
  const named = await parse("ataco a B", "es", { defaultTargets: [], focus: [] });
  const pronoun = await parse("le pego", "es", { defaultTargets: [], focus: ["b"] });
  const ambiguousPronoun = await parse("le pego", "es", { defaultTargets: [], focus: ["b", "c"] });
  const closest = await parse("ataco al enemigo más cercano", "es", { defaultTargets: [], focus: [] });
  const best = await parse("ataco al mejor objetivo", "es", { defaultTargets: [], focus: [] });
  assert.equal(named.intent.action.targets[0].entity_id, "b"); assert.equal(pronoun.intent.action.targets[0].entity_id, "b");
  assert.equal(ambiguousPronoun.status, "NEEDS_DISAMBIGUATION"); assert.equal(closest.intent.action.targets[0].entity_id, "b");
  assert.equal(best.status, "NEEDS_DISAMBIGUATION");
});

test("fallback scenarios P/Q accept only schema-valid intent data", async () => {
  const colloquial = new DeterministicMockFallbackProvider("mock", () => fallbackIntent("le meto un viaje"));
  const p = await parseSemanticInput("le meto un viaje", { dictionary: esDictionary, config: semanticConfig, locale: "es", context: baseContext, fallbackProvider: colloquial });
  assert.equal(p.status, "RESOLVED"); assert.equal(p.intent.provenance.parser_path, "FALLBACK"); assert.equal(p.intent.action.subtype, "PUNCH");
  const complex = new DeterministicMockFallbackProvider("mock-strategy", () => ({ intent_type: "STRATEGY", confidence: { intent_type: 0.8 }, strategy: { strategy_id: "fallback.strategy", owner: "a", steps: [{ step_id: "feint", kind: "PRIMITIVE", action: { type: "FEINT", subtype: null, targets: [{ entity_id: "b", source_span: null }], target_zone: null, direction: null, distance: null, intensity: null, quantity: 1, object_ref: null, execution_class: "ACTION", primitive: "FEINT" }, primitive: "FEINT", execution_class: "ACTION", depends_on: [] }] } }));
  const q = await parseSemanticInput("movimiento táctico desconocido", { dictionary: esDictionary, config: semanticConfig, locale: "es", context: baseContext, fallbackProvider: complex });
  assert.equal(q.status, "RESOLVED"); assert.equal(compileSemanticIntent(q.intent, baseContext).strategy.nodes[0].primitive.id, "FEINT");
});

test("fallback scenarios R-U reject outcome authority, unknown abilities/entities, and invalid schemas", async () => {
  const candidates = [
    { ...fallbackIntent("x"), final_damage: 80 },
    { intent_type: "ABILITY_USE", confidence: { intent_type: 0.8 }, ability_use: { ability_id: "unknown.ability", actor_id: "a", targets: [{ type: "character", ref: "b", position: null, body_zone: null }], parameters: {}, declared_options: {} } },
    fallbackIntent("x", { ...fallbackIntent("x").action, targets: [{ entity_id: "missing", source_span: null }] }),
    { arbitrary: "json" }
  ];
  for (const [index, candidate] of candidates.entries()) {
    const provider = new DeterministicMockFallbackProvider(`invalid-${index}`, () => candidate);
    const result = await parseSemanticInput(`unknown phrase ${index}`, { dictionary: esDictionary, config: semanticConfig, locale: "es", context: baseContext, fallbackProvider: provider });
    assert.equal(result.status, "REJECTED"); assert.ok(["FALLBACK_VALIDATION_ERROR", "UNKNOWN_ABILITY", "INVALID_ENTITY"].includes(result.errors[0].code));
  }
});

test("unsupported locales and unknown fallback action types fail before compilation", async () => {
  await assert.rejects(() => parseSemanticInput("attack", { dictionary: enDictionary, config: semanticConfig, locale: "fr", context: { ...baseContext, locale: "fr" } }), (error) => error.code === "LOCALE_UNSUPPORTED");
  const provider = new DeterministicMockFallbackProvider("invalid-action", () => fallbackIntent("x", { ...fallbackIntent("x").action, type: "INVENTED_OUTCOME" }));
  const result = await parseSemanticInput("unknown semantic action", { dictionary: esDictionary, config: semanticConfig, locale: "es", context: baseContext, fallbackProvider: provider });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.errors[0].code, "FALLBACK_VALIDATION_ERROR");
});

test("fallback scenarios V/W bypass fallback on rules and retain candidates without promotion", async () => {
  const provider = new DeterministicMockFallbackProvider("unused", () => fallbackIntent("unused"));
  const direct = await parseSemanticInput("le pego", { dictionary: esDictionary, config: semanticConfig, locale: "es", context: baseContext, fallbackProvider: provider });
  assert.equal(direct.status, "RESOLVED"); assert.equal(provider.calls, 0);
  const store = new CandidateLearningStore();
  await parseSemanticInput("le meto un viaje", { dictionary: esDictionary, config: semanticConfig, locale: "es", context: baseContext, fallbackProvider: new DeterministicMockFallbackProvider("mock", () => fallbackIntent("x")), candidateStore: store });
  assert.equal(store.snapshot()[0].promoted, false); assert.throws(() => store.promote(), /automatic promotion/i);
});

test("dictionary precedence, order, collision reporting, and compilation cache are deterministic", () => {
  const locale = { ...clone(spanishEntries[0]), entry_id: "test.locale", surface_forms: ["choque"], canonical_type: "ATTACK", namespace: "LOCALE" };
  const session = { ...clone(locale), entry_id: "test.session", canonical_type: "BLOCK", namespace: "SESSION" };
  const first = compileSemanticDictionary([locale, session], { locale: "es" });
  const second = compileSemanticDictionary([session, locale], { locale: "es" });
  assert.equal(first.hash, second.hash); assert.equal(first.match("choque")[0].canonical_type, "BLOCK");
  const collision = compileSemanticDictionary([{ ...locale, entry_id: "test.one" }, { ...locale, entry_id: "test.two", canonical_type: "MOVE" }], { locale: "es" });
  assert.equal(collision.collisions.length, 1);
  const cache = new SemanticDictionaryCompilationCache(); const a = cache.compile([locale], { locale: "es" }); const b = cache.compile([clone(locale)], { locale: "es" });
  assert.equal(a, b); assert.equal(cache.hits, 1);
});

test("semantic cache is equivalent and dictionary/registry hashes partition stale contexts", async () => {
  const cache = new SemanticParseCache();
  const cold = await parseSemanticInput("le pego", { dictionary: esDictionary, config: semanticConfig, locale: "es", context: baseContext, cache });
  const warm = await parseSemanticInput("le pego", { dictionary: esDictionary, config: semanticConfig, locale: "es", context: baseContext, cache });
  assert.deepEqual(cold.intent.action, warm.intent.action); assert.equal(warm.intent.provenance.cache_status, "CONTEXT_HIT");
  const changed = compileSemanticDictionary([...spanishEntries, { ...clone(spanishEntries[0]), entry_id: "session.extra", namespace: "SESSION", surface_forms: ["golpecito"] }], { locale: "es" });
  await parseSemanticInput("le pego", { dictionary: changed, config: semanticConfig, locale: "es", context: baseContext, cache });
  assert.equal(cache.stats().context_size, 2);
});

test("field confidence and diagnostics are interpretable and non-mechanical", async () => {
  const results = [await parse("le pego"), await parse("ataco al enemigo", "es", { defaultTargets: [], focus: [] }), await parse("nada reconocible", "es", { defaultTargets: [], focus: [] })];
  const inspected = inspectSemanticParse(results[0]); const diagnostics = summarizeSemanticParses(results, esDictionary);
  assert.equal(inspected.parser_path, "RULE"); assert.ok(inspected.overall_confidence >= 0.8);
  assert.equal(diagnostics.total, 3); assert.equal(Object.hasOwn(diagnostics, "strategy_score"), false);
});

test("semantic direct action compilation is mechanically identical to manual normalized input", async () => {
  const parsed = await parse("le pego"); const compiled = compileSemanticIntent(parsed.intent, baseContext);
  const manual = clone(compiled.actions[0]);
  const left = engine.resolveTurn({ ...clone(scenario), id: "semantic-left", actions: compiled.actions, reactions: [], trace: false, seed: "semantic-equivalence" });
  const right = engine.resolveTurn({ ...clone(scenario), id: "semantic-right", actions: [manual], reactions: [], trace: false, seed: "semantic-equivalence" });
  assert.equal(canonicalHash(left), canonicalHash(right));
});

test("semantic ability use delegates to v0.4 and equals the manually instantiated payload", async () => {
  const parsed = await parse("uso Heavy Strike contra B"); const compiled = compileSemanticIntent(parsed.intent, baseContext);
  const manual = instantiateAbilityUse(abilityRegistry.get(parsed.intent.ability_use.ability_id), parsed.intent.ability_use, { characters: scenario.characters, world: scenario.world });
  assert.equal(stableStringify(compiled.ability_payload), stableStringify(manual));
  const semanticResult = engine.resolveTurn({ ...clone(scenario), actions: compiled.ability_payload.actions, reactions: [], seed: "semantic-ability", trace: false });
  const manualResult = engine.resolveTurn({ ...clone(scenario), actions: manual.actions, reactions: [], seed: "semantic-ability", trace: false });
  assert.equal(canonicalHash(semanticResult), canonicalHash(manualResult));
});

test("semantic Tactical Opening reaches Strategy DAG/session mechanics without semantic outcome authority", async () => {
  const parsed = await parse("Uso Tactical Opening contra B"); const compiled = compileSemanticIntent(parsed.intent, baseContext);
  const fixture = clone(sessionScenarios.N); fixture.initial_snapshot.strategies = compiled.ability_payload.strategy_fragments; fixture.steps = fixture.steps.slice(0, 2); fixture.trace = false;
  const result = engine.resolveSession(fixture);
  assert.equal(result.stepResults.length, 2); assert.ok(result.finalSnapshot.strategies.length === 1);
  assert.equal(JSON.stringify(result).includes("original_text"), false);
});

test("rule-created generic strategy validates and enters the v0.3.1 scheduler", async () => {
  const parsed = await parse("tiro algo a su izquierda para distraerlo y me muevo detrás");
  const compiled = compileSemanticIntent(parsed.intent, baseContext);
  const fixture = clone(sessionScenarios.N); fixture.initial_snapshot.strategies = [compiled.strategy]; fixture.steps = fixture.steps.slice(0, 1); fixture.trace = false;
  const result = engine.resolveSession(fixture);
  assert.equal(result.stepResults.length, 1); assert.ok(result.finalSnapshot.strategies[0].nodes.some((node) => node.state !== "PENDING"));
});

test("semantic modules execute no arbitrary code and forbidden dependency directions remain empty", async () => {
  const root = engine.config.specDir;
  for (const file of ["src/index.js", "src/combat.js", "src/turn.js", "src/session.js", "src/strategy.js", "src/ability-parser/compiler.js", "src/ability-parser/index.js"]) {
    const source = await readFile(join(root, file), "utf8"); assert.doesNotMatch(source, /from\s+["'][^"']*semantic-input/i, file);
  }
  const semanticDir = join(root, "src", "semantic-input");
  for (const file of (await readdir(semanticDir, { recursive: true })).filter((name) => name.endsWith(".js"))) {
    const source = await readFile(join(semanticDir, file), "utf8"); assert.doesNotMatch(source, /eval\s*\(|new\s+Function|child_process|exec\s*\(/, file); assert.doesNotMatch(source, /resolve(?:Turn|Encounter|Session)\s*\(/, file);
  }
});

test("trace/diagnostic option does not change normalized semantic mechanics", async () => {
  const a = await parse("le pego"); const b = await parse("le pego");
  assert.deepEqual(a.intent.action, b.intent.action); assert.deepEqual(compileSemanticIntent(a.intent, baseContext).actions, compileSemanticIntent(b.intent, baseContext).actions);
});
