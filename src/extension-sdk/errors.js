export class ExtensionError extends Error {
  constructor(code, message, path = null, details = null) {
    super(message);
    this.name = "ExtensionError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

export function extensionError(code, message, path, details) {
  return new ExtensionError(code, message, path, details);
}
