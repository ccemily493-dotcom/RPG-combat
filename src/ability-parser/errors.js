export class AbilityParserError extends Error {
  constructor(code, message, path = null, details = []) {
    super(message);
    this.name = "AbilityParserError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

export function parserError(code, message, path = null, details = []) {
  return new AbilityParserError(code, message, path, details);
}
