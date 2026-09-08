/**
 * Exit codes, so scripts can branch on the kind of failure rather than
 * parsing stderr. 64 and 75 follow sysexits(3).
 */
export const EXIT = {
  /** API error other than auth/eligibility, or a transport failure. */
  FAILURE: 1,
  /** 401 — key missing, invalid, or not provisioned on this environment. */
  UNAUTHORIZED: 2,
  /** 403 — the key works but the account is not eligible for this call. */
  NOT_ELIGIBLE: 3,
  /** EX_USAGE — unknown command, missing argument, malformed flag. */
  USAGE: 64,
  /** EX_TEMPFAIL — not an error in the request, try again later. */
  TEMPFAIL: 75,
} as const;

/** Errors the CLI knows how to print without a stack trace. */
export class CliError extends Error {
  readonly exitCode: number;
  /** Extra lines appended to the rendering, e.g. how to retry safely. */
  readonly hints: string[] = [];

  constructor(message: string, exitCode: number = EXIT.FAILURE) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }

  hint(line: string): this {
    this.hints.push(line);
    return this;
  }

  /** Multi-line rendering used by the top-level error handler. */
  describe(): string {
    return [this.message, ...this.hints.map((hint) => `  ${hint}`)].join("\n");
  }
}

/** A non-2xx response from the Partner API, carrying its error envelope. */
export class ApiError extends CliError {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(init: {
    status: number;
    message: string;
    code?: string | undefined;
    details?: unknown;
    requestId?: string | undefined;
  }) {
    super(init.message, exitCodeForStatus(init.status));
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }

  override describe(): string {
    const head = this.code
      ? `${this.code} (HTTP ${this.status}): ${this.message}`
      : `HTTP ${this.status}: ${this.message}`;
    const lines = [head];
    if (this.details !== undefined && this.details !== null) {
      lines.push(`  details: ${JSON.stringify(this.details)}`);
    }
    if (this.requestId) {
      lines.push(`  x-request-id: ${this.requestId}`);
    }
    lines.push(...this.hints.map((hint) => `  ${hint}`));
    return lines.join("\n");
  }
}

/**
 * 401 means the key is wrong; 403 means the key is fine but the account is
 * not eligible (suspended, not accredited, custody registration incomplete).
 * They need different fixes, so they get different exit codes. 404 stays a
 * plain failure: it covers both "unknown id" and "not yours".
 */
export function exitCodeForStatus(status: number): number {
  if (status === 401) return EXIT.UNAUTHORIZED;
  if (status === 403) return EXIT.NOT_ELIGIBLE;
  return EXIT.FAILURE;
}

/** Bad CLI input — unknown command, missing argument, malformed flag. */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT.USAGE);
    this.name = "UsageError";
  }
}
