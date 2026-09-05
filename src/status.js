import { ValidationError } from "./errors.js";
import { clamp, deepClone, roundTo } from "./utils.js";

function durationRank(value) {
  return value === null ? Number.POSITIVE_INFINITY : value;
}

function candidateOrder(left, right) {
  return (right.definitionPriority ?? 0) - (left.definitionPriority ?? 0)
    || right.intensity - left.intensity
    || durationRank(right.remaining_turns) - durationRank(left.remaining_turns)
    || left.source_ref.localeCompare(right.source_ref);
}

function longestDuration(values) {
  if (values.some((value) => value === null)) return null;
  return Math.max(0, ...values);
}

function asStatus(candidate, statusId, definition) {
  return {
    id: statusId,
    source_ref: candidate.source_ref,
    intensity: roundTo(candidate.intensity),
    remaining_turns: candidate.remaining_turns,
    stacking_rule: definition.merge_policy,
    tags: [...definition.tags].sort()
  };
}

export function mergeStatuses(existingStatuses, additions, removals, definitions) {
  const removedIds = new Set(removals.map((removal) => removal.statusId));
  const retained = existingStatuses.filter((status) => !removedIds.has(status.id)).map(deepClone);
  const changes = removals.map((removal) => ({ type: "status_remove", statusId: removal.statusId, sourceRef: removal.sourceRef }));
  const conflicts = [];
  const grouped = new Map();
  for (const addition of additions) grouped.set(addition.statusId, [...(grouped.get(addition.statusId) ?? []), addition]);

  for (const [statusId, attempts] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const definition = definitions[statusId];
    if (!definition) throw new ValidationError(`Unknown status definition: ${statusId}`);
    const current = retained.filter((status) => status.id === statusId);
    const currentCandidates = current.map((status) => ({ ...status, definitionPriority: definition.priority ?? 0, existing: true }));
    const newCandidates = attempts.map((attempt) => ({
      source_ref: attempt.sourceRef,
      intensity: attempt.intensity,
      remaining_turns: attempt.remainingTurns,
      definitionPriority: definition.priority ?? 0,
      existing: false
    })).sort(candidateOrder);
    retained.splice(0, retained.length, ...retained.filter((status) => status.id !== statusId));
    let merged;
    switch (definition.merge_policy) {
      case "refresh": {
        const candidates = [...currentCandidates, ...newCandidates].sort(candidateOrder);
        const strongest = candidates[0];
        merged = asStatus({ ...strongest, intensity: Math.max(...candidates.map((item) => item.intensity)), remaining_turns: longestDuration(candidates.map((item) => item.remaining_turns)) }, statusId, definition);
        break;
      }
      case "stack": {
        const candidates = [...currentCandidates, ...newCandidates].sort(candidateOrder);
        const limited = definition.max_stacks === null || definition.max_stacks === undefined ? candidates : candidates.slice(0, definition.max_stacks);
        const intensity = clamp(0, definition.intensity_cap ?? Infinity, limited.reduce((sum, item) => sum + item.intensity, 0));
        const duration = longestDuration(limited.map((item) => item.remaining_turns));
        merged = asStatus({ ...limited[0], intensity, remaining_turns: definition.duration_cap === null || duration === null ? duration : Math.min(duration, definition.duration_cap ?? duration) }, statusId, definition);
        break;
      }
      case "replace":
        merged = asStatus(newCandidates[0], statusId, definition);
        break;
      case "ignore":
        merged = currentCandidates.length ? asStatus(currentCandidates.sort(candidateOrder)[0], statusId, definition) : asStatus(newCandidates[0], statusId, definition);
        break;
      case "strongest_wins":
        merged = asStatus([...currentCandidates, ...newCandidates].sort(candidateOrder)[0], statusId, definition);
        break;
      default:
        throw new ValidationError(`Unsupported status merge policy: ${definition.merge_policy}`);
    }
    retained.push(merged);
    changes.push({ type: "status_merge", statusId, policy: definition.merge_policy, attemptCount: attempts.length, result: deepClone(merged) });
    if (removedIds.has(statusId)) conflicts.push({ code: "STATUS_REMOVE_ADD_SAME_TURN", statusId, policy: "removal_before_addition" });
  }

  retained.sort((a, b) => a.id.localeCompare(b.id) || a.source_ref.localeCompare(b.source_ref));
  return { statuses: retained, changes, conflicts };
}
