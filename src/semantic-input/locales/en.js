function entry(id, forms, type, subtype = null, tags = []) {
  return { entry_id: `core.en.${id}`, locale: "en", namespace: "LOCALE", version: "1.0.0", surface_forms: forms, canonical_type: type, canonical_subtype: subtype, ability_id: null, tags, priority: 0, constraints: {}, examples: [], source: "core-locale-en" };
}

export const englishEntries = Object.freeze([
  entry("attack.punch", ["punch", "hit", "throw a punch", "strike him", "strike her", "strike them"], "ATTACK", "PUNCH"),
  entry("attack.kick", ["kick"], "ATTACK", "KICK"), entry("attack.headbutt", ["headbutt"], "ATTACK", "HEADBUTT"),
  entry("attack.shove", ["shove", "push him", "push her"], "ATTACK", "SHOVE"), entry("attack.slash", ["slash", "cut"], "ATTACK", "SLASH"),
  entry("attack.thrust", ["thrust", "stab"], "ATTACK", "THRUST"), entry("attack.shot", ["shoot", "fire", "shot"], "ATTACK", "SHOT"),
  entry("throw.object", ["throw something", "throw a rock"], "THROW", "THROW_OBJECT"),
  entry("defend", ["defend", "guard"], "DEFEND"), entry("dodge", ["dodge", "evade"], "DODGE"), entry("block", ["block"], "BLOCK"), entry("parry", ["parry"], "PARRY"),
  entry("grab", ["grab", "hold"], "GRAB"), entry("release", ["release", "let go"], "RELEASE"),
  entry("move", ["move"], "MOVE"), entry("run", ["run"], "RUN"), entry("walk", ["walk"], "WALK"), entry("approach", ["approach", "move toward"], "APPROACH"),
  entry("retreat", ["retreat", "move away"], "RETREAT"), entry("jump", ["jump"], "JUMP"), entry("crouch", ["crouch"], "CROUCH"), entry("turn", ["turn around"], "TURN"),
  entry("interact", ["interact"], "INTERACT"), entry("use.object", ["use the object"], "USE_OBJECT"), entry("wait", ["wait"], "WAIT"), entry("observe", ["observe", "look"], "OBSERVE"), entry("aim", ["aim"], "AIM"),
  entry("interrupt", ["interrupt"], "INTERRUPT"), entry("counter", ["counter", "counterattack"], "COUNTER"),
  entry("strategy.feint", ["feint"], "FEINT"), entry("strategy.distraction", ["distract", "distraction"], "DISTRACTION"), entry("strategy.ambush", ["ambush"], "AMBUSH"),
  entry("strategy.flank", ["flank"], "FLANK"), entry("strategy.blind_spot", ["blind spot"], "BLIND_SPOT"), entry("strategy.bait", ["bait"], "BAIT"), entry("strategy.trap", ["trap"], "TRAP"),
  entry("strategy.cover", ["take cover", "cover"], "COVER"), entry("strategy.reposition", ["reposition", "move behind"], "REPOSITION"),
  entry("strategy.interrupt_setup", ["prepare an interrupt"], "INTERRUPT_SETUP"), entry("strategy.counter_setup", ["prepare a counter"], "COUNTER_SETUP"),
  entry("strategy.isolate", ["isolate"], "ISOLATE"), entry("strategy.resource_denial", ["deny resources"], "RESOURCE_DENIAL"), entry("strategy.area_denial", ["deny the area", "area denial"], "AREA_DENIAL"), entry("strategy.escape", ["prepare escape"], "ESCAPE_SETUP")
]);
