import type { FetchLike } from "../src/client.ts";
import { run, type RunDeps, type RunOutcome } from "../src/cli.ts";

export interface RecordedRequest {
  method: string;
  url: string;
  path: string;
  /** Repeated params are preserved, since the API takes multi-valued filters. */
  query: Record<string, string[]>;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  /** Raw body, for testing non-JSON and empty responses. */
  text?: string;
  /** Binary body, for the document download route; set content-type in headers. */
  bytes?: Uint8Array;
  headers?: Record<string, string>;
}

export type Responder =
  | StubResponse
  | ((request: RecordedRequest) => StubResponse);

export interface Stub {
  fetch: FetchLike;
  requests: RecordedRequest[];
  /** The only request made; fails loudly if there were none or several. */
  only(): RecordedRequest;
}

export function createFetch(responder: Responder = {}): Stub {
  const requests: RecordedRequest[] = [];

  const fetchImpl: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const query: Record<string, string[]> = {};
    for (const [key, value] of parsed.searchParams) {
      (query[key] ??= []).push(value);
    }

    const headers = normalizeHeaders(init?.headers);
    const rawBody = init?.body;
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      url,
      path: parsed.pathname,
      query,
      headers,
      body: typeof rawBody === "string" ? safeParse(rawBody) : undefined,
    };
    requests.push(request);

    const stub = typeof responder === "function" ? responder(request) : responder;
    const status = stub.status ?? 200;
    if (stub.bytes) {
      return new Response(stub.bytes, { status, headers: { ...stub.headers } });
    }
    const text = stub.text ?? JSON.stringify(stub.body ?? {});

    return new Response(text, {
      status,
      headers: { "content-type": "application/json", ...stub.headers },
    });
  };

  return {
    fetch: fetchImpl,
    requests,
    only(): RecordedRequest {
      if (requests.length !== 1) {
        throw new Error(`expected exactly 1 request, saw ${requests.length}`);
      }
      return requests[0]!;
    },
  };
}

export const TEST_ENV = {
  LBX_API: "https://api.test",
  LBX_KEY: "lbx_stg_test",
};

export interface RunCliOptions {
  env?: Record<string, string | undefined>;
  /** Extra deps forwarded to run(): a fake clock, sleep, or file reader. */
  deps?: Partial<Omit<RunDeps, "env" | "fetch" | "stderr">>;
}

/**
 * Drive the whole CLI the way bin/lbx.ts does, with a stubbed transport.
 * Lines the command wrote eagerly to stderr come back in `notes` and are
 * folded into `stderr` ahead of any error, matching what a terminal shows.
 */
export async function runCli(
  argv: string[],
  responder: Responder = {},
  envOrOptions: Record<string, string | undefined> | RunCliOptions = TEST_ENV,
): Promise<RunOutcome & { requests: RecordedRequest[]; stub: Stub; notes: string[] }> {
  const options: RunCliOptions =
    "env" in envOrOptions || "deps" in envOrOptions
      ? (envOrOptions as RunCliOptions)
      : { env: envOrOptions as Record<string, string | undefined> };
  const stub = createFetch(responder);
  const notes: string[] = [];
  const outcome = await run(argv, {
    env: options.env ?? TEST_ENV,
    fetch: stub.fetch,
    stderr: (line) => notes.push(line),
    ...options.deps,
  });
  const stderr = [...notes, outcome.stderr].filter((s) => s !== "").join("\n");
  return { ...outcome, stderr, requests: stub.requests, stub, notes };
}

/** Assert-and-return: surfaces stderr when a command unexpectedly failed. */
export function expectOk(outcome: RunOutcome): string {
  if (outcome.exitCode !== 0) {
    throw new Error(`expected success, got ${outcome.exitCode}: ${outcome.stderr}`);
  }
  return outcome.stdout;
}

function normalizeHeaders(headers: RequestInit["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (headers instanceof Headers) {
    for (const [key, value] of headers) result[key.toLowerCase()] = value;
    return result;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) result[String(key).toLowerCase()] = String(value);
    return result;
  }
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = String(value);
  }
  return result;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
