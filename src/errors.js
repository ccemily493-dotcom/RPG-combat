export class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export class ResolutionError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ResolutionError";
    this.details = details;
  }
}

export class InsufficientResourcesError extends ResolutionError {
  constructor(characterId, resource, required, available) {
    super(`Character ${characterId} requires ${required} ${resource}, but has ${available}.`, {
      characterId,
      resource,
      required,
      available
    });
    this.name = "InsufficientResourcesError";
  }
}
