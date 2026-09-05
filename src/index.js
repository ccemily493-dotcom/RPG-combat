import { loadEngineConfig } from "./config.js";
import { lintSpecifications } from "./lint.js";
import { compileSchemas } from "./schema.js";
import { resolveEncounter } from "./combat.js";
import { resolveTurn } from "./turn.js";
import { replay, replayTurn } from "./replay.js";
import { replaySession, resolveSession, resolveSessionStep } from "./session.js";

export { loadEngineConfig } from "./config.js";
export { lintSpecifications as lint } from "./lint.js";
export { compileSchemas } from "./schema.js";
export { resolveModifiers, evaluatePredicate } from "./modifiers.js";
export { microVariance, applyMicroVariance, varianceKey } from "./variance.js";
export { applyTuningOverrides, cartesianSweep } from "./tuning.js";
export { applyPenetrationToFilter, boundedHarmCapacityMultiplier, classifyDefenseEffectiveness, combineSequentialFilters, receivedNormalPower } from "./combat.js";
export { planMultiAttack } from "./multi.js";
export { deterministicActionOrder, targetAllocation, actionCostPlan, compareBatchEquivalence, resolveTurn } from "./turn.js";
export { mergeStatuses } from "./status.js";
export { ActionTransaction, TurnReservationLedger, TurnTransaction } from "./transaction.js";
export { evaluateBalanceExpectations, validationClassSummary } from "./balance.js";
export { buildCombatScenarios, loadCombatScenarios } from "./scenarios.js";
export { buildSessionScenarios, loadSessionScenarios } from "./session-scenarios.js";
export { summarizeStrategySessions } from "./session-diagnostics.js";
export { replay, replayTurn } from "./replay.js";
export { replaySession, resolveSession, resolveSessionStep } from "./session.js";
export {
  applyTemporalEffect,
  cooldownAvailable,
  createTemporalState,
  evaluateTemporalPredicate,
  finishOpportunityConsumption,
  processTemporalEnd,
  processTemporalStart,
  validateTemporalReferences
} from "./temporal.js";
export {
  beginStrategyStep,
  completeStrategyStep,
  scheduleStrategyNodes,
  strategyDiagnostics,
  validateStrategyDag
} from "./strategy.js";
export { canonicalHash, stableStringify } from "./utils.js";
export { generateSpecializedProfiles, loadProfileTemplates, validateSpecializedProfiles } from "./calibration/profiles.js";
export { evaluateCompositionExpression, evaluateDefenseModels, loadDefenseCompositionProfiles, summarizeDefenseComparisons } from "./calibration/defense-models.js";
export { buildBenchmarkEncounter, loadBenchmarkAssets, profileIndex, runCohort, summarizeCohort, benchmarkPerformance } from "./calibration/benchmark.js";
export { runParameterSweep, sweepToCsv } from "./calibration/sweep.js";
export { histogram, mean, quantile, summarize, thresholdDiagnostics } from "./calibration/statistics.js";
export * from "./errors.js";

export function createEngine(config) {
  const schemas = compileSchemas(config);
  const engine = {
    config,
    schemas,
    resolveEncounter(input) {
      return resolveEncounter(config, schemas, input);
    },
    resolveTurn(input) {
      return resolveTurn(engine, input);
    },
    replay(input, expected = null) {
      return replay(engine, input, expected);
    },
    replayTurn(input, expected = null) {
      return replayTurn(engine, input, expected);
    },
    resolveSessionStep(input) {
      return resolveSessionStep(engine, input);
    },
    resolveSession(input) {
      return resolveSession(engine, input);
    },
    replaySession(input, expected = null) {
      return replaySession(engine, input, expected);
    }
  };
  return Object.freeze(engine);
}

export async function createDefaultEngine() {
  const config = await loadEngineConfig();
  const lint = await lintSpecifications(config);
  if (!lint.ok) throw new Error(`Specification lint failed:\n${lint.issues.join("\n")}`);
  return createEngine(config);
}
