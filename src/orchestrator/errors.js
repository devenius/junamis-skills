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

export class OrchestratorError extends Error {
  constructor(message, { code = "error", exitCode = EXIT.ERROR, detail = null, halt = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
    this.detail = detail;
    this.halt = halt;
  }
}

export class UsageError extends OrchestratorError {
  constructor(message, options = {}) {
    super(message, { code: "usage", exitCode: EXIT.ERROR, ...options });
  }
}

export class IoError extends OrchestratorError {
  constructor(message, options = {}) {
    super(message, { code: "io_error", exitCode: EXIT.ERROR, ...options });
  }
}

export class LeaseHeldError extends OrchestratorError {
  constructor(owner, options = {}) {
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
  constructor(sessionId, options = {}) {
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
  constructor(diff, options = {}) {
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
  constructor(message, options = {}) {
    super(message, {
      code: "corrupt_state",
      exitCode: EXIT.CORRUPT,
      halt: "corrupt_state",
      ...options,
    });
  }
}

export class TransitionError extends OrchestratorError {
  constructor(message, options = {}) {
    super(message, { code: "invalid_transition", exitCode: EXIT.TRANSITION, ...options });
  }
}

export class IdentityChangeError extends OrchestratorError {
  constructor(message, options = {}) {
    super(message, { code: "identity_change", exitCode: EXIT.TRANSITION, ...options });
  }
}

export class HandoffError extends OrchestratorError {
  constructor(message, options = {}) {
    super(message, { code: "invalid_handoff", exitCode: EXIT.TRANSITION, ...options });
  }
}

export function isOrchestratorError(error) {
  return error instanceof OrchestratorError;
}
