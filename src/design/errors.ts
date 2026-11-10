// Typed errors for the design registry.
//
// The CLI maps one error class to one exit code. Validation errors carry every
// problem found so a single run can report the whole file.

export interface DesignErrorOptions {
  readonly code?: string;
  readonly exitCode?: number;
  readonly detail?: unknown;
}

export class DesignError extends Error {
  declare readonly code: string;
  declare readonly exitCode: number;
  declare readonly detail: unknown;

  constructor(
    message: string,
    { code = "design_error", exitCode = 1, detail = null }: DesignErrorOptions = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

export class UsageError extends DesignError {
  constructor(message: string, options: DesignErrorOptions = {}) {
    super(message, { code: "usage", ...options });
  }
}

export class ValidationError extends DesignError {
  declare readonly errors: readonly string[];

  constructor(message: string, { errors = [], detail = null }: { readonly errors?: readonly string[]; readonly detail?: unknown } = {}) {
    super(message, { code: "invalid_design", detail: detail ?? { errors } });
    this.errors = errors;
  }
}

export class DeltaError extends DesignError {
  constructor(message: string, { code = "invalid_delta", detail = null }: DesignErrorOptions = {}) {
    super(message, { code, detail });
  }
}
