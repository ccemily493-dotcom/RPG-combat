import { coefficient } from "./config.js";
import { ValidationError } from "./errors.js";
import { evaluatePredicate } from "./modifiers.js";
import { canonicalHash, clamp, deepClone, distance3, getPath, roundTo } from "./utils.js";

const PHASES = Object.freeze(["TURN_START", "PRE_ACTION", "ACTION_RESOLUTION", "POST_ACTION", "TURN_END"]);

export function createTemporalState(overrides = {}) {
  return {
    phase: "TURN_START",
    scheduled_effects: [],
    relations: [],
    opportunities: [],
    recovery_hooks: [],
    mechanical_history: [],
    session: { status: "ACTIVE", step_index: 0, termination_reason: null },
    ...deepClone(overrides)
  };
}

function compare(left, operator, right) {
  if (operator === "eq") return left === right;
  if (operator === "ne") return left !== right;
  if (operator === "lt") return left < right;
  if (operator === "lte") return left <= right;
  if (operator === "gt") return left > right;
  if (operator === "gte") return left >= right;
  if (operator === "in") return Array.isArray(right) && right.includes(left);
  if (operator === "contains") return (Array.isArray(left) || typeof left === "string") && left.includes(right);
  throw new ValidationError(`Unsupported temporal predicate operator: ${operator}`);
}

function predicateEvents(context) {
  const declared = (context.declarations?.actions ?? []).map((action) => ({
    type: "action_declared",
    actor_refs: [action.actor_id],
    target_refs: action.targets.filter((target) => target.type === "character").map((target) => target.ref),
    action_ref: action.id,
    payload: { kind: action.kind, tags: action.tags }
  }));
  const history = (context.temporal_state?.mechanical_history ?? []).flatMap((turn) => turn.events);
  return [...(context.events ?? []), ...declared, ...history];
}

export function evaluateTemporalPredicate(predicate, context) {
  if (!predicate) return true;
  if (predicate.all) return predicate.all.every((child) => evaluateTemporalPredicate(child, context));
  if (predicate.any) return predicate.any.some((child) => evaluateTemporalPredicate(child, context));
  if (predicate.not) return !evaluateTemporalPredicate(predicate.not, context);
  if (predicate.event_occurred) {
    const query = predicate.event_occurred;
    return predicateEvents(context).some((event) => event.type === query.type
      && (!query.actor_ref || event.actor_refs?.includes(query.actor_ref))
      && (!query.target_ref || event.target_refs?.includes(query.target_ref))
      && (!query.action_ref || event.action_ref === query.action_ref));
  }
  if (predicate.relation_exists) {
    const query = predicate.relation_exists;
    return (context.temporal_state?.relations ?? []).some((relation) => !relation.consumed
      && relation.kind === query.kind && relation.subject_ref === query.subject_ref && relation.object_ref === query.object_ref);
  }
  if (predicate.status_present) {
    const query = predicate.status_present;
    return Boolean(context.characters?.[query.character_ref]?.statuses.some((status) => status.id === query.status_id));
  }
  if (predicate.distance) {
    const query = predicate.distance;
    const left = context.characters?.[query.left_ref]?.transform.position;
    const right = context.characters?.[query.right_ref]?.transform.position;
    return Boolean(left && right && compare(distance3(left, right), query.operator, query.value));
  }
  if (predicate.area_occupied) {
    const query = predicate.area_occupied;
    return Boolean(context.characters?.[query.entity_ref]
      && context.world?.environment?.hazards.some((hazard) => hazard.geometry_ref === query.area_ref));
  }
  if (predicate.compare) {
    const left = typeof predicate.compare.left === "string" ? getPath(context, predicate.compare.left) : predicate.compare.left;
    const right = predicate.compare.right && typeof predicate.compare.right === "object" && Object.hasOwn(predicate.compare.right, "path")
      ? getPath(context, predicate.compare.right.path)
      : predicate.compare.right;
    if (left === undefined || right === undefined) return false;
    return compare(left, predicate.compare.operator, right);
  }
  return evaluatePredicate(predicate, context);
}

export function validateTemporalReferences(temporalState, characters, world) {
  const ids = new Set(Object.keys(characters));
  const validEntity = (id) => ids.has(id) || world.entity_refs.includes(id) || world.geometry_refs.includes(id);
  const validateOpportunity = (opportunity) => {
    if (!ids.has(opportunity.owner_ref) || (opportunity.target_ref && !validEntity(opportunity.target_ref))) throw new ValidationError(`Opportunity ${opportunity.id} references an unknown entity.`);
    if (opportunity.reaction_template && !ids.has(opportunity.reaction_template.reactor_id)) throw new ValidationError(`Opportunity ${opportunity.id} has an unknown reaction reactor.`);
    for (const effect of opportunity.effects) validateEffect(effect, opportunity.id);
  };
  const validateScheduled = (scheduled) => {
    if (scheduled.target_ref && !validEntity(scheduled.target_ref)) throw new ValidationError(`Scheduled effect ${scheduled.id} references an unknown target.`);
    for (const effect of scheduled.effects) validateEffect(effect, scheduled.id);
  };
  const validateEffect = (effect, sourceId) => {
    if (effect.type === "RESOURCE_DELTA" && !ids.has(effect.target_ref)) throw new ValidationError(`Temporal effect from ${sourceId} references unknown character ${effect.target_ref}.`);
    if (effect.type === "ADD_MODIFIER" && effect.scope === "CHARACTER" && !ids.has(effect.target_ref)) throw new ValidationError(`Temporal modifier from ${sourceId} references unknown character ${effect.target_ref}.`);
    if (effect.type === "ADD_RELATION" && (!ids.has(effect.relation.subject_ref) || !ids.has(effect.relation.object_ref))) throw new ValidationError(`Temporal relation from ${sourceId} references an unknown entity.`);
    if (effect.type === "SCHEDULE_EFFECT") validateScheduled(effect.scheduled_effect);
    if (effect.type === "CREATE_OPPORTUNITY") validateOpportunity(effect.opportunity);
  };
  const seen = new Set();
  for (const collection of [temporalState.scheduled_effects, temporalState.relations, temporalState.opportunities, temporalState.recovery_hooks]) {
    for (const item of collection) {
      if (seen.has(item.id)) throw new ValidationError(`Duplicate temporal id: ${item.id}`);
      seen.add(item.id);
    }
  }
  for (const relation of temporalState.relations) {
    if (!ids.has(relation.subject_ref) || !ids.has(relation.object_ref)) throw new ValidationError(`Relational state ${relation.id} references an unknown entity.`);
  }
  for (const opportunity of temporalState.opportunities) validateOpportunity(opportunity);
  for (const hook of temporalState.recovery_hooks) if (!ids.has(hook.character_ref)) throw new ValidationError(`Recovery hook ${hook.id} references an unknown character.`);
  for (const effect of temporalState.scheduled_effects) validateScheduled(effect);
  return true;
}

function cooldownRemaining(cooldown) {
  return typeof cooldown === "number" ? cooldown : cooldown.remaining;
}

export function cooldownAvailable(character, key) {
  const cooldown = character?.cooldowns?.[key];
  return cooldown === undefined || cooldownRemaining(cooldown) <= 0;
}

export function assertCooldownAvailability(characters, actions) {
  for (const action of actions) {
    const key = action.cooldown?.key ?? action.id;
    const cooldown = characters[action.actor_id]?.cooldowns?.[key];
    if (cooldown !== undefined && cooldownRemaining(cooldown) > 0) {
      throw new ValidationError(`Action ${action.id} is unavailable: cooldown ${key} has ${cooldownRemaining(cooldown)} turn(s) remaining.`);
    }
  }
}

function progressCooldowns(characters) {
  const events = [];
  for (const [characterId, character] of Object.entries(characters).sort(([a], [b]) => a.localeCompare(b))) {
    for (const key of Object.keys(character.cooldowns).sort()) {
      const current = character.cooldowns[key];
      const before = cooldownRemaining(current);
      const after = Math.max(0, before - 1);
      if (typeof current === "number") character.cooldowns[key] = after;
      else current.remaining = after;
      events.push({ type: "cooldown_progressed", character_ref: characterId, cooldown: key, before, after });
      if (after === 0) {
        delete character.cooldowns[key];
        events.push({ type: "cooldown_available", character_ref: characterId, cooldown: key });
      }
    }
  }
  return events;
}

function recoverCapacities(characters) {
  const events = [];
  for (const [characterId, character] of Object.entries(characters).sort(([a], [b]) => a.localeCompare(b))) {
    const economy = character.action_economy;
    const beforeActions = economy.actions_remaining ?? (economy.available ? 1 : 0);
    const beforeReactions = economy.reactions_remaining ?? (economy.reaction_available ? 1 : 0);
    economy.actions_remaining = economy.action_capacity ?? beforeActions;
    economy.reactions_remaining = economy.reaction_capacity ?? beforeReactions;
    economy.actions_reserved = 0;
    economy.reactions_reserved = 0;
    economy.available = economy.actions_remaining > 0;
    economy.reaction_available = economy.reactions_remaining > 0;
    events.push({ type: "capacity_recovered", character_ref: characterId, actions_before: beforeActions, actions_after: economy.actions_remaining, reactions_before: beforeReactions, reactions_after: economy.reactions_remaining });
  }
  return events;
}

function applyRecoveryHooks(snapshot) {
  const events = [];
  for (const hook of [...snapshot.temporal_state.recovery_hooks].filter((item) => item.enabled).sort((a, b) => a.id.localeCompare(b.id))) {
    const character = snapshot.characters[hook.character_ref];
    if (hook.kind === "RESOURCE") {
      const resource = character.resources[hook.resource];
      if (!resource) throw new ValidationError(`Recovery hook ${hook.id} references unknown resource ${hook.resource}.`);
      const before = resource.current;
      resource.current = roundTo(clamp(0, resource.maximum, before + hook.amount));
      events.push({ type: "resource_recovered", id: hook.id, character_ref: character.id, resource: hook.resource, before, after: resource.current });
    } else {
      const reaction = hook.kind === "REACTION_CAPACITY";
      const remaining = reaction ? "reactions_remaining" : "actions_remaining";
      const capacity = reaction ? "reaction_capacity" : "action_capacity";
      const flag = reaction ? "reaction_available" : "available";
      const before = character.action_economy[remaining];
      character.action_economy[remaining] = Math.min(character.action_economy[capacity], before + hook.amount);
      character.action_economy[flag] = character.action_economy[remaining] > 0;
      events.push({ type: "capacity_hook_recovered", id: hook.id, character_ref: character.id, kind: hook.kind, before, after: character.action_economy[remaining] });
    }
  }
  return events;
}

function pushUnique(collection, item, label) {
  if (collection.some((candidate) => candidate.id === item.id)) throw new ValidationError(`Duplicate ${label} id: ${item.id}`);
  collection.push(item);
  collection.sort((a, b) => a.id.localeCompare(b.id));
}

function progressPhaseCollection(collection, phase, label, events) {
  const retained = [];
  for (const item of [...collection].sort((left, right) => left.id.localeCompare(right.id))) {
    if (item.duration?.type !== "PHASE" || item.duration.phase !== phase) {
      retained.push(item);
      continue;
    }
    const remaining = Math.max(0, item.duration.remaining - 1);
    events.push({ type: "duration_progressed", state_kind: label, state_id: item.id, phase, remaining });
    if (remaining === 0) events.push({ type: "temporal_state_expired", state_kind: label, state_id: item.id, phase });
    else retained.push({ ...item, duration: { ...item.duration, remaining } });
  }
  return retained;
}

function progressPhaseState(snapshot, phase, events) {
  snapshot.temporal_state.relations = progressPhaseCollection(snapshot.temporal_state.relations, phase, "RELATION", events);
  snapshot.temporal_state.opportunities = progressPhaseCollection(snapshot.temporal_state.opportunities, phase, "OPPORTUNITY", events);
  snapshot.world.modifiers = progressPhaseCollection(snapshot.world.modifiers, phase, "WORLD_MODIFIER", events);
  for (const [characterId, character] of Object.entries(snapshot.characters).sort(([left], [right]) => left.localeCompare(right))) {
    character.modifiers = progressPhaseCollection(character.modifiers, phase, `CHARACTER_MODIFIER:${characterId}`, events);
    character.statuses = progressPhaseCollection(character.statuses, phase, `STATUS:${characterId}`, events);
  }
}

export function applyTemporalEffect(snapshot, effect, context, sourceRef) {
  const events = [];
  const currentTurn = snapshot.world.turn;
  if (effect.type === "ADD_MODIFIER") {
    const modifier = { ...deepClone(effect.modifier), source_ref: effect.modifier.source_ref ?? sourceRef, duration: deepClone(effect.duration), created_turn: currentTurn };
    if (effect.scope === "WORLD") pushUnique(snapshot.world.modifiers, modifier, "world modifier");
    else if (effect.scope === "CHARACTER") {
      const character = snapshot.characters[effect.target_ref];
      if (!character) throw new ValidationError(`Modifier effect references unknown character ${effect.target_ref}.`);
      pushUnique(character.modifiers, modifier, "character modifier");
    } else {
      const action = context.declarations.actions.find((candidate) => candidate.id === effect.target_ref);
      if (!action) throw new ValidationError(`Action modifier effect references unknown declaration ${effect.target_ref}.`);
      modifier.layer = "ACTION";
      pushUnique(action.modifiers, modifier, "action modifier");
    }
    events.push({ type: "modifier_added", modifier_id: modifier.id, scope: effect.scope, target_ref: effect.target_ref ?? null, source_ref: sourceRef });
  } else if (effect.type === "REMOVE_MODIFIER") {
    const collection = effect.scope === "WORLD" ? snapshot.world.modifiers : snapshot.characters[effect.target_ref]?.modifiers;
    if (!collection) throw new ValidationError(`Remove modifier effect references unknown target ${effect.target_ref}.`);
    const before = collection.length;
    collection.splice(0, collection.length, ...collection.filter((modifier) => modifier.id !== effect.modifier_id));
    events.push({ type: "modifier_removed", modifier_id: effect.modifier_id, removed: collection.length !== before, source_ref: sourceRef });
  } else if (effect.type === "ADD_RELATION") {
    const relation = { ...deepClone(effect.relation), source_ref: effect.relation.source_ref ?? sourceRef, created_turn: currentTurn, consumed: false };
    if (!snapshot.characters[relation.subject_ref] || !snapshot.characters[relation.object_ref]) throw new ValidationError(`Relation ${relation.id} references an unknown entity.`);
    pushUnique(snapshot.temporal_state.relations, relation, "relation");
    events.push({ type: "relation_added", relation_id: relation.id, kind: relation.kind, source_ref: sourceRef });
  } else if (effect.type === "REMOVE_RELATION") {
    const before = snapshot.temporal_state.relations.length;
    snapshot.temporal_state.relations = snapshot.temporal_state.relations.filter((relation) => relation.id !== effect.relation_id);
    events.push({ type: "relation_removed", relation_id: effect.relation_id, removed: snapshot.temporal_state.relations.length !== before, source_ref: sourceRef });
  } else if (effect.type === "SCHEDULE_EFFECT") {
    const scheduled = { ...deepClone(effect.scheduled_effect), source_ref: effect.scheduled_effect.source_ref ?? sourceRef, created_turn: currentTurn, activated: false };
    pushUnique(snapshot.temporal_state.scheduled_effects, scheduled, "scheduled effect");
    events.push({ type: "effect_scheduled", scheduled_effect_id: scheduled.id, source_ref: sourceRef });
  } else if (effect.type === "CREATE_OPPORTUNITY") {
    const opportunity = { ...deepClone(effect.opportunity), source_ref: effect.opportunity.source_ref ?? sourceRef, created_turn: currentTurn, trigger_count: 0, consumed: false };
    pushUnique(snapshot.temporal_state.opportunities, opportunity, "opportunity");
    events.push({ type: "opportunity_created", opportunity_id: opportunity.id, kind: opportunity.kind, source_ref: sourceRef });
  } else if (effect.type === "RESOURCE_DELTA") {
    const character = snapshot.characters[effect.target_ref];
    const resource = character?.resources?.[effect.resource];
    if (!resource) throw new ValidationError(`Resource effect references unknown ${effect.target_ref}.${effect.resource}.`);
    const before = resource.current;
    resource.current = roundTo(clamp(0, resource.maximum, before + effect.amount));
    events.push({ type: "temporal_resource_delta", character_ref: character.id, resource: effect.resource, before, after: resource.current, delta: roundTo(resource.current - before), source_ref: sourceRef });
  } else {
    throw new ValidationError(`Unsupported temporal effect: ${effect.type}`);
  }
  return events;
}

function activationReady(scheduled, phase, context) {
  const activation = scheduled.activation;
  if (activation.type === "TURN") return phase === "TURN_START" && context.world.turn >= activation.turn;
  if (activation.type === "PHASE") return phase === activation.phase;
  if (activation.type === "ACTION") return phase === "POST_ACTION" && (context.events ?? []).filter((event) => event.type === "action_resolved").length >= activation.action_count;
  return evaluateTemporalPredicate(activation.condition, context);
}

export function activateScheduledEffects(snapshot, declarations, phase, existingEvents = []) {
  const events = [];
  const context = { ...snapshot, declarations, events: existingEvents };
  for (const scheduled of [...snapshot.temporal_state.scheduled_effects].filter((item) => !item.activated).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    if (!activationReady(scheduled, phase, context)) continue;
    for (const effect of scheduled.effects) events.push(...applyTemporalEffect(snapshot, effect, { declarations }, scheduled.id));
    scheduled.activated = true;
    events.push({ type: "scheduled_effect_activated", scheduled_effect_id: scheduled.id, phase });
  }
  snapshot.temporal_state.scheduled_effects = snapshot.temporal_state.scheduled_effects.filter((item) => !item.activated);
  return events;
}

function opportunityAction(opportunity, declarations) {
  return [...declarations.actions]
    .filter((action) => action.actor_id !== opportunity.owner_ref && (!opportunity.target_ref || action.actor_id === opportunity.target_ref))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
}

export function triggerOpportunities(snapshot, declarations, existingEvents = []) {
  const events = [];
  const generatedReactions = [];
  const reactionBindings = [];
  const context = { ...snapshot, declarations, events: existingEvents };
  for (const opportunity of [...snapshot.temporal_state.opportunities].filter((item) => !item.consumed).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!evaluateTemporalPredicate(opportunity.trigger, context)) continue;
    opportunity.trigger_count += 1;
    for (const effect of opportunity.effects) events.push(...applyTemporalEffect(snapshot, effect, { declarations }, opportunity.id));
    if (opportunity.reaction_template) {
      const action = opportunityAction(opportunity, declarations);
      if (action) {
        const reaction = { ...deepClone(opportunity.reaction_template), target_action_id: action.id };
        generatedReactions.push(reaction);
        reactionBindings.push({ opportunityId: opportunity.id, reactionId: reaction.id, consumption: opportunity.consumption });
      }
    }
    const effectSucceeded = opportunity.effects.length > 0;
    if (["ON_TRIGGER", "ON_USE", "ON_ATTEMPT"].includes(opportunity.consumption)
      || (opportunity.consumption === "ON_SUCCESS" && !opportunity.reaction_template && effectSucceeded)) opportunity.consumed = true;
    events.push({ type: "opportunity_triggered", opportunity_id: opportunity.id, kind: opportunity.kind, trigger_count: opportunity.trigger_count, consumed: opportunity.consumed });
  }
  snapshot.temporal_state.opportunities = snapshot.temporal_state.opportunities.filter((item) => !item.consumed);
  return { events, generatedReactions, reactionBindings };
}

export function finishOpportunityConsumption(temporalState, reactionBindings, reactionResults) {
  const results = new Map(reactionResults.map((result) => [result.id, result]));
  const consumed = [];
  for (const binding of reactionBindings) {
    if (binding.consumption !== "ON_SUCCESS" || results.get(binding.reactionId)?.outcome !== "applied") continue;
    const opportunity = temporalState.opportunities.find((item) => item.id === binding.opportunityId);
    if (opportunity && !opportunity.consumed) {
      opportunity.consumed = true;
      consumed.push({ opportunityId: opportunity.id, semantics: "ON_SUCCESS", resultRef: binding.reactionId });
    }
  }
  temporalState.opportunities = temporalState.opportunities.filter((opportunity) => !opportunity.consumed);
  return consumed;
}

export function injectRelationalModifiers(snapshot, actions) {
  const declarations = deepClone(actions);
  const applied = [];
  for (const relation of [...snapshot.temporal_state.relations].filter((item) => !item.consumed).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const binding of relation.modifiers) {
      for (const action of declarations) {
        const targets = action.targets.filter((target) => target.type === "character").map((target) => target.ref);
        if (action.actor_id !== binding.actor_ref || !targets.includes(binding.target_ref) || (binding.action_kind && binding.action_kind !== action.kind)) continue;
        const modifier = deepClone(binding.modifier);
        modifier.layer = "ACTION";
        modifier.id = `${relation.id}:${modifier.id}`;
        modifier.source_ref = relation.id;
        action.modifiers.push(modifier);
        applied.push({ relationId: relation.id, actionId: action.id, modifierId: modifier.id, consumption: relation.consumption });
        if (["ON_ATTEMPT", "ON_USE"].includes(relation.consumption)) relation.consumed = true;
      }
    }
  }
  return { actions: declarations, applied };
}

export function finishRelationalConsumption(temporalState, applied, actionResults) {
  const byId = new Map(actionResults.map((result) => [result.id, result]));
  const consumed = [];
  for (const use of applied) {
    const relation = temporalState.relations.find((item) => item.id === use.relationId);
    if (!relation) continue;
    if (relation.consumed) {
      if (!consumed.some((item) => item.relationId === relation.id)) consumed.push({ relationId: relation.id, semantics: use.consumption, resultRef: use.actionId });
      continue;
    }
    const result = byId.get(use.actionId);
    if (use.consumption === "ON_SUCCESS" && result?.contactCount > 0) {
      relation.consumed = true;
      consumed.push({ relationId: relation.id, semantics: "ON_SUCCESS", resultRef: use.actionId });
    }
  }
  temporalState.relations = temporalState.relations.filter((relation) => !relation.consumed);
  return consumed;
}

export function processTemporalStart(inputSnapshot, declarations, config) {
  const snapshot = deepClone(inputSnapshot);
  snapshot.temporal_state.phase = "TURN_START";
  validateTemporalReferences(snapshot.temporal_state, snapshot.characters, snapshot.world);
  const events = [];
  events.push(...activateScheduledEffects(snapshot, declarations, "TURN_START", events));
  progressPhaseState(snapshot, "TURN_START", events);
  events.push(...progressCooldowns(snapshot.characters));
  if (config.specs["temporal.yaml"].recovery.action_capacity.restore_to_capacity || config.specs["temporal.yaml"].recovery.reaction_capacity.restore_to_capacity) events.push(...recoverCapacities(snapshot.characters));
  events.push(...applyRecoveryHooks(snapshot));
  snapshot.temporal_state.phase = "PRE_ACTION";
  events.push(...activateScheduledEffects(snapshot, declarations, "PRE_ACTION", events));
  progressPhaseState(snapshot, "PRE_ACTION", events);
  return { snapshot, events };
}

function progressDuration(duration, itemCreatedTurn, worldTurn, context) {
  if (!duration || duration.type === "PERMANENT") return { duration, expired: false, progressed: false };
  let shouldProgress = false;
  if (duration.type === "TURN") shouldProgress = itemCreatedTurn < worldTurn;
  if (duration.type === "PHASE") return { duration, expired: false, progressed: false };
  const actionCount = (context.events ?? []).filter((event) => event.type === "action_resolved").length;
  const reactionCount = (context.events ?? []).filter((event) => event.type === "reaction_resolved").length;
  if (duration.type === "ACTION") shouldProgress = actionCount > 0;
  if (duration.type === "REACTION_WINDOW") shouldProgress = reactionCount > 0;
  if (duration.type === "UNTIL_TRIGGERED") return { duration, expired: (context.triggerIds ?? []).includes(duration.trigger), progressed: false };
  if (duration.type === "UNTIL_CONDITION") return { duration, expired: evaluateTemporalPredicate(duration.condition, context), progressed: false };
  if (!shouldProgress || duration.remaining === null || duration.remaining === undefined) return { duration, expired: false, progressed: false };
  const progressAmount = duration.type === "ACTION" ? actionCount : duration.type === "REACTION_WINDOW" ? reactionCount : 1;
  const remaining = Math.max(0, duration.remaining - progressAmount);
  return { duration: { ...duration, remaining }, expired: remaining === 0, progressed: true };
}

function progressCollection(collection, worldTurn, context, label, events) {
  const retained = [];
  for (const item of [...collection].sort((a, b) => a.id.localeCompare(b.id))) {
    const result = progressDuration(item.duration, item.created_turn ?? 0, worldTurn, context);
    if (result.progressed) events.push({ type: "duration_progressed", state_kind: label, state_id: item.id, remaining: result.duration.remaining });
    if (result.expired) events.push({ type: "temporal_state_expired", state_kind: label, state_id: item.id });
    else retained.push({ ...item, duration: result.duration });
  }
  return retained;
}

export function installCooldowns(characters, actions, actionResults, usedTurn) {
  const events = [];
  const results = new Map(actionResults.map((result) => [result.id, result]));
  for (const action of [...actions].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!action.cooldown || results.get(action.id)?.outcome !== "resolved") continue;
    const key = action.cooldown.key ?? action.id;
    characters[action.actor_id].cooldowns[key] = {
      remaining: action.cooldown.duration,
      duration: action.cooldown.duration,
      unit: action.cooldown.unit,
      starts: action.cooldown.starts,
      started_turn: usedTurn,
      source_ref: action.id
    };
    events.push({ type: "cooldown_started", character_ref: action.actor_id, cooldown: key, remaining: action.cooldown.duration, source_ref: action.id });
  }
  return events;
}

function progressCharacterTemporalState(snapshot, startingCharacters, context, events) {
  for (const [characterId, character] of Object.entries(snapshot.characters).sort(([a], [b]) => a.localeCompare(b))) {
    const starting = startingCharacters[characterId];
    const startingStatuses = new Map((starting?.statuses ?? []).map((status) => [status.id, canonicalHash(status)]));
    const statuses = [];
    for (const status of [...character.statuses].sort((a, b) => a.id.localeCompare(b.id))) {
      const changedThisTurn = !startingStatuses.has(status.id) || startingStatuses.get(status.id) !== canonicalHash(status);
      const createdTurn = changedThisTurn ? snapshot.world.turn : (status.created_turn ?? 0);
      if (status.duration) {
        const result = progressDuration(status.duration, createdTurn, snapshot.world.turn, context);
        if (result.expired) events.push({ type: "status_expired", character_ref: characterId, status_id: status.id });
        else statuses.push({ ...status, duration: result.duration, created_turn: createdTurn });
      } else if (status.remaining_turns === null || createdTurn >= snapshot.world.turn) {
        statuses.push({ ...status, created_turn: createdTurn });
      } else {
        const remaining = Math.max(0, status.remaining_turns - 1);
        if (remaining === 0) events.push({ type: "status_expired", character_ref: characterId, status_id: status.id });
        else statuses.push({ ...status, remaining_turns: remaining, created_turn: createdTurn });
      }
    }
    character.statuses = statuses;
    character.modifiers = progressCollection(character.modifiers.map((modifier) => ({ ...modifier, created_turn: modifier.created_turn ?? 0 })), snapshot.world.turn, context, "CHARACTER_MODIFIER", events);
  }
  snapshot.world.modifiers = progressCollection(snapshot.world.modifiers.map((modifier) => ({ ...modifier, created_turn: modifier.created_turn ?? 0 })), snapshot.world.turn, context, "WORLD_MODIFIER", events);
}

export function processTemporalEnd(snapshot, startingSnapshot, declarations, combinedEvents, config, terminationPredicates = []) {
  snapshot.temporal_state.phase = "POST_ACTION";
  const events = [];
  events.push(...activateScheduledEffects(snapshot, declarations, "POST_ACTION", combinedEvents));
  progressPhaseState(snapshot, "POST_ACTION", events);
  snapshot.temporal_state.phase = "TURN_END";
  events.push(...activateScheduledEffects(snapshot, declarations, "TURN_END", [...combinedEvents, ...events]));
  progressPhaseState(snapshot, "TURN_END", events);
  const context = { ...snapshot, declarations, events: [...combinedEvents, ...events], triggerIds: [...combinedEvents, ...events].map((event) => event.type) };
  snapshot.temporal_state.relations = progressCollection(snapshot.temporal_state.relations, snapshot.world.turn, context, "RELATION", events);
  snapshot.temporal_state.opportunities = progressCollection(snapshot.temporal_state.opportunities, snapshot.world.turn, context, "OPPORTUNITY", events);
  progressCharacterTemporalState(snapshot, startingSnapshot.characters, context, events);
  if (terminationPredicates.some((predicate) => evaluateTemporalPredicate(predicate, context))) {
    snapshot.temporal_state.session.status = "COMPLETED";
    snapshot.temporal_state.session.termination_reason = "configured_predicate";
    events.push({ type: "session_completed", reason: "configured_predicate" });
  }
  const previousTurn = snapshot.world.turn - 1;
  const historyEvents = [...combinedEvents, ...events].map((event, sequence) => ({ ...deepClone(event), sequence }));
  snapshot.temporal_state.mechanical_history.push({ turn: previousTurn, events: historyEvents, snapshot_hash: canonicalHash({ world: snapshot.world, characters: snapshot.characters }) });
  const maximumHistory = coefficient(config.specs["temporal.yaml"].mechanical_history.maximum_turns);
  snapshot.temporal_state.mechanical_history = snapshot.temporal_state.mechanical_history
    .sort((a, b) => a.turn - b.turn)
    .slice(-maximumHistory);
  snapshot.temporal_state.session.step_index += 1;
  snapshot.temporal_state.phase = "TURN_START";
  return events;
}

export function temporalPhases() {
  return PHASES;
}
