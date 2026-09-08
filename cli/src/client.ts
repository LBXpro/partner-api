import { maskKey, type Config } from "./config.ts";
import { ApiError, CliError } from "./errors.ts";
import { buildQuery, type Query } from "./query.ts";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ClientOptions {
  fetch?: FetchLike;
  userAgent?: string;
  /** Receives one line per request and response; wired to stderr by --verbose. */
  log?: (line: string) => void;
  /** Per-request budget, covering the body read. 0 disables. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/** A non-JSON response body, as returned by the document download route. */
export interface Download {
  bytes: Uint8Array;
  contentType: string | undefined;
  /** Filename the server suggested via Content-Disposition, already reduced to a basename. */
  filename: string | undefined;
}

interface ErrorEnvelope {
  error?: unknown;
  code?: unknown;
  details?: unknown;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Thin typed wrapper over the Partner API's bearer-auth JSON surface. */
export class PartnerClient {
  private readonly config: Config;
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;
  private readonly log: ((line: string) => void) | undefined;
  private readonly timeoutMs: number;

  constructor(config: Config, options: ClientOptions = {}) {
    this.config = config;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.userAgent = options.userAgent ?? "lbx-partner-cli";
    this.log = options.log;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get apiUrl(): string {
    return this.config.apiUrl;
  }

  /** The key as it may be shown: prefix and tail only. */
  get maskedKey(): string {
    return maskKey(this.config.apiKey);
  }

  get<T = unknown>(path: string, query: Query = {}): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  /** GET a file rather than JSON; the error path is still the JSON envelope. */
  async download(path: string): Promise<Download> {
    const { response, bytes, requestId } = await this.send("GET", path, {
      headers: { Accept: "application/pdf, application/octet-stream, */*" },
    });
    if (!response.ok) {
      const text = decode(bytes);
      throw toApiError(response.status, parseJson(text), text, requestId);
    }
    return {
      bytes,
      contentType: response.headers.get("content-type") ?? undefined,
      filename: filenameFromDisposition(response.headers.get("content-disposition")),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const { response, bytes, requestId, url } = await this.send(method, path, {
      ...options,
      headers: { Accept: "application/json", ...options.headers },
    });
    const text = decode(bytes);
    const parsed = parseJson(text);

    if (!response.ok) {
      throw toApiError(response.status, parsed, text, requestId);
    }

    if (text.trim() === "") return undefined as T;
    if (parsed === PARSE_FAILED) {
      throw new CliError(
        `Expected JSON from ${url} but got: ${truncate(text, 200)}`,
      );
    }
    return parsed as T;
  }

  /**
   * One transport round-trip: build the URL and headers, apply the timeout to
   * the whole exchange including the body read, and log it when asked. The
   * body comes back as bytes so JSON and file responses share this path.
   */
  private async send(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<{ response: Response; bytes: Uint8Array; requestId: string | undefined; url: string }> {
    const url = `${this.config.apiUrl}${path}${buildQuery(options.query ?? {})}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "User-Agent": this.userAgent,
      ...options.headers,
    };

    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    init.signal = controller.signal;
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;

    this.log?.(`> ${method} ${url}`);
    this.log?.(`> authorization: Bearer ${this.maskedKey}`);
    for (const [name, value] of Object.entries(headers)) {
      if (name === "Authorization") continue;
      this.log?.(`> ${name.toLowerCase()}: ${value}`);
    }
    const started = Date.now();

    let response: Response;
    let bytes: Uint8Array;
    try {
      response = await this.fetchImpl(url, init);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new CliError(
          `Request to ${url} timed out after ${this.timeoutMs / 1000}s (raise it with --timeout)`,
        );
      }
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new CliError(`Request to ${url} failed: ${reason}`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;
    this.log?.(
      `< ${response.status} ${response.statusText} ${bytes.byteLength} bytes in ${Date.now() - started} ms` +
        (requestId ? ` (x-request-id ${requestId})` : ""),
    );
    return { response, bytes, requestId, url };
  }
}

const PARSE_FAILED = Symbol("parse-failed");

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return PARSE_FAILED;
  }
}

function toApiError(
  status: number,
  parsed: unknown,
  rawText: string,
  requestId: string | undefined,
): ApiError {
  const envelope: ErrorEnvelope =
    parsed !== PARSE_FAILED && typeof parsed === "object" && parsed !== null
      ? (parsed as ErrorEnvelope)
      : {};

  const message =
    typeof envelope.error === "string" && envelope.error !== ""
      ? envelope.error
      : rawText.trim() !== ""
        ? truncate(rawText.trim(), 200)
        : `Request failed with status ${status}`;

  return new ApiError({
    status,
    message,
    code: typeof envelope.code === "string" ? envelope.code : undefined,
    details: envelope.details,
    requestId,
  });
}

/**
 * `filename*=UTF-8''…` (RFC 5987) wins over `filename="…"`. Whatever the
 * server said is reduced to a basename, so a header can never steer the
 * write outside the directory the user chose.
 */
export function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  let name: string | undefined;

  const extended = /filename\*\s*=\s*(?:[\w-]+)?''([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      name = decodeURIComponent(extended[1].trim());
    } catch {
      name = undefined;
    }
  }
  if (name === undefined) {
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
    name = (plain?.[1] ?? plain?.[2])?.trim();
  }
  if (!name) return undefined;

  const base = name.split(/[\\/]/).pop()?.trim() ?? "";
  if (base === "" || base === "." || base === "..") return undefined;
  return base;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
