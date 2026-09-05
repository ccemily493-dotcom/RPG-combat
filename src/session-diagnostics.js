import { mean, quantile } from "./calibration/statistics.js";

function finite(values) {
  return values.filter(Number.isFinite);
}

function modifierValues(strategies) {
  return strategies.flatMap((strategy) => strategy.nodes).flatMap((node) => [
    ...node.effects.on_success,
    ...node.effects.on_failure,
    ...node.effects.on_completion
  ]).filter((effect) => effect.type === "ADD_MODIFIER" && Number.isFinite(effect.modifier?.value)).map((effect) => Math.abs(effect.modifier.value));
}

export function summarizeStrategySessions(sessionResults) {
  const resolved = sessionResults.filter((entry) => entry.result);
  const allNodes = resolved.flatMap(({ result }) => result.finalSnapshot.strategies.flatMap((strategy) => strategy.nodes));
  const executedResults = resolved.flatMap(({ result }) => result.stepResults.flatMap((step) => step.strategyProgress.results));
  const transitions = resolved.flatMap(({ result }) => result.stepResults.flatMap((step) => step.strategyProgress.transitions));
  const temporalEvents = resolved.flatMap(({ result }) => result.stepResults.flatMap((step) => step.temporalEvents));
  const setupDurations = [];
  for (const { result } of resolved) {
    const firstExecution = new Map();
    result.stepResults.forEach((step, stepIndex) => {
      for (const nodeResult of step.strategyProgress.results) if (!firstExecution.has(`${nodeResult.strategyId}:${nodeResult.nodeId}`)) firstExecution.set(`${nodeResult.strategyId}:${nodeResult.nodeId}`, stepIndex);
    });
    setupDurations.push(...firstExecution.values());
  }
  const resourceExpenditure = resolved.flatMap(({ result }) => result.stepResults.flatMap((step) => step.turnResult.trace?.merge?.resourceChanges ?? []))
    .filter((change) => change.delta < 0 && change.resource !== "health" && change.resource !== "stability")
    .reduce((sum, change) => sum - change.delta, 0);
  const modifiers = resolved.flatMap(({ result }) => modifierValues(result.finalSnapshot.strategies));
  const successful = allNodes.filter((node) => node.state === "SUCCEEDED").length;
  const failed = allNodes.filter((node) => node.state === "FAILED").length;
  const opportunityCreated = temporalEvents.filter((event) => event.type === "opportunity_created").length;
  const opportunityTriggered = temporalEvents.filter((event) => event.type === "opportunity_triggered").length;
  return {
    classification: "strategy_diagnostic",
    nonBlocking: true,
    universalQualityThreshold: null,
    sessionsResolved: resolved.length,
    sessionsRejectedBeforeCommit: sessionResults.length - resolved.length,
    nodes: {
      total: allNodes.length,
      executed: executedResults.length,
      succeeded: successful,
      failed,
      blocked: allNodes.filter((node) => node.state === "BLOCKED").length,
      cancelled: allNodes.filter((node) => node.state === "CANCELLED").length,
      successRate: successful + failed ? successful / (successful + failed) : null,
      setupFailureRate: successful + failed ? failed / (successful + failed) : null
    },
    branches: {
      failurePolicyTransitions: transitions.filter((transition) => transition.reason.includes("failure_policy")).length,
      dependencyBlocked: allNodes.filter((node) => node.state === "BLOCKED").length,
      frequencyPerExecutedNode: executedResults.length ? transitions.filter((transition) => transition.reason.includes("failure_policy")).length / executedResults.length : null
    },
    setupDurationTurns: {
      mean: setupDurations.length ? mean(setupDurations) : null,
      median: setupDurations.length ? quantile(setupDurations, 0.5) : null,
      p95: setupDurations.length ? quantile(setupDurations, 0.95) : null
    },
    averageDeclaredPayoffModifier: modifiers.length ? mean(modifiers) : null,
    reactionsConsumed: resolved.flatMap(({ result }) => result.stepResults.flatMap((step) => step.turnResult.reactionResults)).filter((reaction) => ["applied", "failed"].includes(reaction.outcome)).length,
    resourceExpenditure,
    opportunities: {
      created: opportunityCreated,
      triggered: opportunityTriggered,
      unusedOrExpired: Math.max(0, opportunityCreated - opportunityTriggered)
    }
  };
}
