// Typed errors for the design registry.
//
// The CLI maps one error class to one exit code. Validation errors carry every
// problem found so a single run can report the whole file.

export class DesignError extends Error {
  constructor(message, { code = "design_error", exitCode = 1, detail = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

export class UsageError extends DesignError {
  constructor(message, options = {}) {
    super(message, { code: "usage", ...options });
  }
}

export class ValidationError extends DesignError {
  constructor(message, { errors = [], detail = null } = {}) {
    super(message, { code: "invalid_design", detail: detail ?? { errors } });
    this.errors = errors;
  }
}

export class DeltaError extends DesignError {
  constructor(message, { code = "invalid_delta", detail = null } = {}) {
    super(message, { code, detail });
  }
}
