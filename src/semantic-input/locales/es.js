function entry(id, forms, type, subtype = null, tags = []) {
  return { entry_id: `core.es.${id}`, locale: "es", namespace: "LOCALE", version: "1.0.0", surface_forms: forms, canonical_type: type, canonical_subtype: subtype, ability_id: null, tags, priority: 0, constraints: {}, examples: [], source: "core-locale-es" };
}

export const spanishEntries = Object.freeze([
  entry("attack.punch", ["ataco", "le pego", "pego", "golpeo", "le doy", "puñetazo", "le pego una piña", "le meto un golpe", "lo golpeo"], "ATTACK", "PUNCH"),
  entry("attack.kick", ["patada", "le doy una patada", "lo pateo"], "ATTACK", "KICK"),
  entry("attack.headbutt", ["cabezazo"], "ATTACK", "HEADBUTT"),
  entry("attack.shove", ["empujo", "empujón"], "ATTACK", "SHOVE"),
  entry("attack.slash", ["corto", "tajo"], "ATTACK", "SLASH"),
  entry("attack.thrust", ["estocada", "apuñalo"], "ATTACK", "THRUST"),
  entry("attack.shot", ["disparo", "le disparo"], "ATTACK", "SHOT"),
  entry("throw.object", ["tiro algo", "lanzo algo", "tiro una piedra", "lanzo una piedra"], "THROW", "THROW_OBJECT"),
  entry("defend", ["me defiendo", "defiendo"], "DEFEND"), entry("dodge", ["esquivo", "lo esquivo"], "DODGE"),
  entry("block", ["bloqueo", "lo bloqueo"], "BLOCK"), entry("parry", ["desvío", "paro el golpe"], "PARRY"),
  entry("grab", ["agarro", "sujeto"], "GRAB"), entry("release", ["suelto", "lo libero"], "RELEASE"),
  entry("move", ["me muevo", "moverme"], "MOVE"), entry("run", ["corro", "correr"], "RUN"), entry("walk", ["camino", "andar"], "WALK"),
  entry("approach", ["me acerco", "voy hacia"], "APPROACH"), entry("retreat", ["me alejo", "retrocedo", "me retiro"], "RETREAT"),
  entry("jump", ["salto"], "JUMP"), entry("crouch", ["me agacho"], "CROUCH"), entry("turn", ["me giro", "giro"], "TURN"),
  entry("interact", ["interactúo", "interactuo"], "INTERACT"), entry("use.object", ["uso el objeto"], "USE_OBJECT"),
  entry("wait", ["espero", "aguardo"], "WAIT"), entry("observe", ["observo", "miro"], "OBSERVE"), entry("aim", ["apunto"], "AIM"),
  entry("interrupt", ["interrumpo"], "INTERRUPT"), entry("counter", ["contraataco"], "COUNTER"),
  entry("strategy.feint", ["finta", "amago"], "FEINT"), entry("strategy.distraction", ["distraer", "distraerlo", "distraerla", "distracción", "distraigo"], "DISTRACTION"),
  entry("strategy.ambush", ["emboscada"], "AMBUSH"), entry("strategy.flank", ["flanquear", "flanqueo"], "FLANK"),
  entry("strategy.blind_spot", ["punto ciego"], "BLIND_SPOT"), entry("strategy.bait", ["cebo", "provoco que"], "BAIT"),
  entry("strategy.trap", ["trampa"], "TRAP"), entry("strategy.cover", ["cobertura", "me cubro"], "COVER"),
  entry("strategy.reposition", ["me muevo detrás", "me reposiciono", "rodeo"], "REPOSITION"),
  entry("strategy.interrupt_setup", ["preparo una interrupción", "preparo interrumpir"], "INTERRUPT_SETUP"),
  entry("strategy.counter_setup", ["preparo un contraataque"], "COUNTER_SETUP"), entry("strategy.isolate", ["aíslo", "aislo"], "ISOLATE"),
  entry("strategy.resource_denial", ["bloqueo su recurso", "le niego recursos"], "RESOURCE_DENIAL"),
  entry("strategy.area_denial", ["niego el área", "bloqueo la zona"], "AREA_DENIAL"), entry("strategy.escape", ["preparo la huida"], "ESCAPE_SETUP")
]);
