export class SemanticFallbackProvider {
  constructor(id = "unimplemented") { this.id = id; }
  async parseSemanticFallback() { throw new Error("No live semantic fallback provider is implemented in v0.5."); }
}

export class DeterministicMockFallbackProvider extends SemanticFallbackProvider {
  #handler;
  calls = 0;
  constructor(id, handler) { super(id); this.#handler = handler; }
  async parseSemanticFallback(input, context) { this.calls += 1; return structuredClone(await this.#handler(input, context)); }
}
