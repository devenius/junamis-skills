// Typed errors and the fixed exit code table for the orchestrator state engine.
//
// A halt never prints a stack trace. The CLI maps each error type to one exit
// code and one short human line.

export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  LEASE: 2,
  DRIFT: 3,
  CORRUPT: 4,
  TRANSITION: 5,
});

export interface OrchestratorErrorOptions {
  readonly code?: string;
  readonly exitCode?: number;
  readonly detail?: unknown;
  readonly halt?: string | null;
}

export class OrchestratorError extends Error {
  declare readonly code: string;
  declare readonly exitCode: number;
  declare readonly detail: unknown;
  declare readonly halt: string | null;

  constructor(
    message: string,
    { code = "error", exitCode = EXIT.ERROR, detail = null, halt = null }: OrchestratorErrorOptions = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
    this.detail = detail;
    this.halt = halt;
  }
}

export class UsageError extends OrchestratorError {
  constructor(message: string, options: OrchestratorErrorOptions = {}) {
    super(message, { code: "usage", exitCode: EXIT.ERROR, ...options });
  }
}

export class IoError extends OrchestratorError {
  constructor(message: string, options: OrchestratorErrorOptions = {}) {
    super(message, { code: "io_error", exitCode: EXIT.ERROR, ...options });
  }
}

export class LeaseHeldError extends OrchestratorError {
  declare readonly owner: string;

  constructor(owner: string, options: OrchestratorErrorOptions = {}) {
    super(`live lease held by ${owner}`, {
      code: "lease_held",
      exitCode: EXIT.LEASE,
      halt: "lease_held",
      detail: { owner },
      ...options,
    });
    this.owner = owner;
  }
}

export class LeaseLostError extends OrchestratorError {
  constructor(sessionId: string, options: OrchestratorErrorOptions = {}) {
    super(`lease for ${sessionId} is missing or owned by another session`, {
      code: "lease_lost",
      exitCode: EXIT.LEASE,
      halt: "lease_lost",
      detail: { sessionId },
      ...options,
    });
  }
}

export class DriftError extends OrchestratorError {
  declare readonly diff: unknown;

  constructor(diff: unknown, options: OrchestratorErrorOptions = {}) {
    super("environment drift detected", {
      code: "drift",
      exitCode: EXIT.DRIFT,
      halt: "drift",
      detail: diff,
      ...options,
    });
    this.diff = diff;
  }
}

export class CorruptStateError extends OrchestratorError {
  constructor(message: string, options: OrchestratorErrorOptions = {}) {
    super(message, {
      code: "corrupt_state",
      exitCode: EXIT.CORRUPT,
      halt: "corrupt_state",
      ...options,
    });
  }
}

export class TransitionError extends OrchestratorError {
  constructor(message: string, options: OrchestratorErrorOptions = {}) {
    super(message, { code: "invalid_transition", exitCode: EXIT.TRANSITION, ...options });
  }
}

export class IdentityChangeError extends OrchestratorError {
  constructor(message: string, options: OrchestratorErrorOptions = {}) {
    super(message, { code: "identity_change", exitCode: EXIT.TRANSITION, ...options });
  }
}

export class HandoffError extends OrchestratorError {
  constructor(message: string, options: OrchestratorErrorOptions = {}) {
    super(message, { code: "invalid_handoff", exitCode: EXIT.TRANSITION, ...options });
  }
}

export function isOrchestratorError(error: unknown): error is OrchestratorError {
  return error instanceof OrchestratorError;
}
