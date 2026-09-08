import { describe, expect, test } from "bun:test";
import { filenameFromDisposition, PartnerClient } from "../src/client.ts";
import { ApiError, CliError } from "../src/errors.ts";
import { createFetch } from "./helpers.ts";

const config = { apiUrl: "https://api.test", apiKey: "lbx_stg_secret" };

const client = (stub: ReturnType<typeof createFetch>) =>
  new PartnerClient(config, { fetch: stub.fetch, userAgent: "test-agent" });

describe("PartnerClient requests", () => {
  test("GET sends the bearer token and accept header", async () => {
    const stub = createFetch({ body: { ok: true } });
    await client(stub).get("/v1/partner/companies");

    const request = stub.only();
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://api.test/v1/partner/companies");
    expect(request.headers.authorization).toBe("Bearer lbx_stg_secret");
    expect(request.headers.accept).toBe("application/json");
    expect(request.headers["user-agent"]).toBe("test-agent");
  });

  test("GET appends the query string and drops unset filters", async () => {
    const stub = createFetch({ body: {} });
    await client(stub).get("/v1/partner/companies", {
      limit: 5,
      search: undefined,
      industry: ["SaaS", "FinTech"],
    });

    const request = stub.only();
    expect(request.query).toEqual({ limit: ["5"], industry: ["SaaS", "FinTech"] });
  });

  test("GET sends no content-type, since it has no body", async () => {
    const stub = createFetch({ body: {} });
    await client(stub).get("/v1/partner/orders");
    expect(stub.only().headers["content-type"]).toBeUndefined();
  });

  test("POST serializes the body and sets content-type", async () => {
    const stub = createFetch({ body: { order: { id: "o1" } } });
    await client(stub).post("/v1/partner/orders", {
      body: { opportunitySlug: "offer", amount: 15000 },
      headers: { "Idempotency-Key": "abc" },
    });

    const request = stub.only();
    expect(request.method).toBe("POST");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["idempotency-key"]).toBe("abc");
    expect(request.body).toEqual({ opportunitySlug: "offer", amount: 15000 });
  });

  test("returns the parsed JSON body", async () => {
    const stub = createFetch({ body: { total: 967, items: [{ slug: "a" }] } });
    const data = await client(stub).get<{ total: number }>("/v1/partner/companies");
    expect(data.total).toBe(967);
  });

  test("an empty 200 body resolves to undefined", async () => {
    const stub = createFetch({ status: 200, text: "" });
    await expect(client(stub).get("/v1/partner/companies")).resolves.toBeUndefined();
  });
});

describe("PartnerClient errors", () => {
  test("maps the error envelope onto ApiError", async () => {
    const stub = createFetch({
      status: 400,
      body: {
        error: "Request validation failed",
        code: "VALIDATION_ERROR",
        details: { limit: "too large" },
      },
      headers: { "x-request-id": "req-1" },
    });

    const error = (await client(stub)
      .get("/v1/partner/companies")
      .catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Request validation failed");
    expect(error.details).toEqual({ limit: "too large" });
    expect(error.requestId).toBe("req-1");
    expect(error.exitCode).toBe(1);
  });

  test("401 exits 2 (bad key) and 403 exits 3 (account not eligible)", async () => {
    const cases: [number, string, number][] = [
      [401, "UNAUTHORIZED", 2],
      [403, "FORBIDDEN", 3],
      [403, "INVESTOR_SETUP_INCOMPLETE", 3],
      [404, "NOT_FOUND", 1],
      [502, "UPSTREAM_ERROR", 1],
    ];
    for (const [status, code, exitCode] of cases) {
      const stub = createFetch({ status, body: { error: "no", code } });
      const error = (await client(stub)
        .get("/v1/partner/companies")
        .catch((e: unknown) => e)) as ApiError;
      expect(error.exitCode).toBe(exitCode);
    }
  });

  test("hints are appended to the rendering", () => {
    const error = new ApiError({ status: 502, message: "upstream" }).hint("retry with the same key");
    expect(error.describe()).toBe("HTTP 502: upstream\n  retry with the same key");
    expect(new CliError("plain").hint("try again").describe()).toBe("plain\n  try again");
  });

  test("describe() renders code, details and request id", async () => {
    const stub = createFetch({
      status: 404,
      body: { error: "Company not found", code: "NOT_FOUND" },
      headers: { "x-request-id": "req-2" },
    });
    const error = (await client(stub)
      .get("/v1/partner/companies/x")
      .catch((e: unknown) => e)) as ApiError;

    expect(error.describe()).toBe(
      "NOT_FOUND (HTTP 404): Company not found\n  x-request-id: req-2",
    );
  });

  test("falls back to the raw body when the error is not the usual envelope", async () => {
    const stub = createFetch({ status: 502, text: "upstream exploded" });
    const error = (await client(stub)
      .get("/v1/partner/companies")
      .catch((e: unknown) => e)) as ApiError;

    expect(error.message).toBe("upstream exploded");
    expect(error.code).toBeUndefined();
    expect(error.describe()).toBe("HTTP 502: upstream exploded");
  });

  test("an empty error body still produces a useful message", async () => {
    const stub = createFetch({ status: 500, text: "" });
    const error = (await client(stub)
      .get("/v1/partner/companies")
      .catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Request failed with status 500");
  });

  test("a 200 that is not JSON is a CliError, not a crash", async () => {
    const stub = createFetch({ status: 200, text: "<html>login</html>" });
    await expect(client(stub).get("/v1/partner/companies")).rejects.toThrow(
      /Expected JSON/,
    );
  });

  test("a transport failure is wrapped with the URL", async () => {
    const failing = new PartnerClient(config, {
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    const error = (await failing
      .get("/v1/partner/companies")
      .catch((e: unknown) => e)) as CliError;

    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toBe(
      "Request to https://api.test/v1/partner/companies failed: ECONNREFUSED",
    );
  });
});

describe("PartnerClient timeout and logging", () => {
  test("aborts through the signal after the budget and says so", async () => {
    const hanging = new PartnerClient(config, {
      timeoutMs: 5,
      fetch: (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    const error = (await hanging
      .get("/v1/partner/companies")
      .catch((e: unknown) => e)) as CliError;
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toContain("timed out after 0.005s");
  });

  test("timeoutMs 0 sends no deadline", async () => {
    let sawSignal: AbortSignal | null | undefined;
    const stub = createFetch({ body: {} });
    const wrapped = new PartnerClient(config, {
      timeoutMs: 0,
      fetch: (url, init) => {
        sawSignal = init?.signal;
        return stub.fetch(url, init);
      },
    });
    await wrapped.get("/v1/partner/companies");
    expect(sawSignal?.aborted).toBe(false);
  });

  test("log lines carry the masked key, never the real one", async () => {
    const lines: string[] = [];
    const stub = createFetch({ body: {}, headers: { "x-request-id": "req-3" } });
    const logging = new PartnerClient(config, { fetch: stub.fetch, log: (line) => lines.push(line) });
    await logging.post("/v1/partner/orders", { body: { a: 1 }, headers: { "Idempotency-Key": "k1" } });

    expect(lines[0]).toBe("> POST https://api.test/v1/partner/orders");
    expect(lines[1]).toBe("> authorization: Bearer lbx_stg_…cret");
    expect(lines).toContain("> idempotency-key: k1");
    expect(lines.at(-1)).toMatch(/^< 200 .*\(x-request-id req-3\)$/);
    expect(lines.join("\n")).not.toContain("lbx_stg_secret");
  });
});

describe("filenameFromDisposition", () => {
  test("reads a quoted filename", () => {
    expect(filenameFromDisposition('attachment; filename="prospectus.pdf"')).toBe("prospectus.pdf");
  });

  test("reads a bare filename", () => {
    expect(filenameFromDisposition("inline; filename=receipt.pdf")).toBe("receipt.pdf");
  });

  test("prefers the RFC 5987 form and decodes it", () => {
    expect(
      filenameFromDisposition("attachment; filename=\"fallback.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"),
    ).toBe("résumé.pdf");
  });

  test("reduces any path to its basename so a header cannot escape the directory", () => {
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"')).toBe("passwd");
    expect(filenameFromDisposition('attachment; filename="C:\\\\x\\\\y.pdf"')).toBe("y.pdf");
    expect(filenameFromDisposition('attachment; filename=".."')).toBeUndefined();
  });

  test("returns undefined when there is nothing usable", () => {
    expect(filenameFromDisposition(null)).toBeUndefined();
    expect(filenameFromDisposition("attachment")).toBeUndefined();
    expect(filenameFromDisposition('attachment; filename=""')).toBeUndefined();
  });
});
