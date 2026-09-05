export class SemanticInputError extends Error {
  constructor(code, message, path = null, sourceSpan = null, details = []) {
    super(message);
    this.name = "SemanticInputError";
    this.code = code;
    this.path = path;
    this.sourceSpan = sourceSpan;
    this.details = details;
  }
}

export function semanticError(code, message, path = null, sourceSpan = null, details = []) {
  return new SemanticInputError(code, message, path, sourceSpan, details);
}
