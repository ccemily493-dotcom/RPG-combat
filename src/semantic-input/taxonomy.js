export const ACTION_TYPES = Object.freeze(["ATTACK", "DEFEND", "MOVE", "DODGE", "BLOCK", "PARRY", "GRAB", "RELEASE", "THROW", "JUMP", "CROUCH", "RUN", "WALK", "TURN", "APPROACH", "RETREAT", "INTERACT", "USE_OBJECT", "USE_ABILITY", "WAIT", "OBSERVE", "TARGET", "AIM", "REPOSITION", "INTERRUPT", "COUNTER"]);
export const STRATEGIC_PRIMITIVES = Object.freeze(["FEINT", "DISTRACTION", "AMBUSH", "FLANK", "BLIND_SPOT", "BAIT", "TRAP", "COVER", "REPOSITION", "INTERRUPT_SETUP", "COUNTER_SETUP", "ISOLATE", "RESOURCE_DENIAL", "AREA_DENIAL", "ESCAPE_SETUP"]);
export const DELIVERY_SUBTYPES = Object.freeze(["PUNCH", "KICK", "HEADBUTT", "SHOVE", "SLASH", "THRUST", "PROJECTILE", "SHOT", "THROW_OBJECT"]);

export function defaultExecutionClass(type) {
  if (["MOVE", "RUN", "WALK", "APPROACH", "RETREAT", "REPOSITION", "JUMP", "CROUCH", "TURN"].includes(type)) return "MOVEMENT";
  if (["DODGE", "BLOCK", "PARRY", "COUNTER", "INTERRUPT"].includes(type)) return "REACTION";
  if (["WAIT", "OBSERVE", "TARGET", "AIM"].includes(type)) return "ZERO_TIME";
  return "ACTION";
}
