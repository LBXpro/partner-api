import { describe, expect, test } from "bun:test";
import { DEFAULT_API_URL, maskKey, resolveConfig } from "../src/config.ts";
import { UsageError } from "../src/errors.ts";

describe("resolveConfig", () => {
  test("falls back to the staging base URL", () => {
    const config = resolveConfig({}, { LBX_KEY: "k" });
    expect(config).toEqual({ apiUrl: DEFAULT_API_URL, apiKey: "k" });
  });

  test("environment overrides the default", () => {
    const config = resolveConfig({}, { LBX_KEY: "k", LBX_API: "https://env.test" });
    expect(config.apiUrl).toBe("https://env.test");
  });

  test("flags override the environment", () => {
    const config = resolveConfig(
      { api: "https://flag.test", apiKey: "flagkey" },
      { LBX_KEY: "envkey", LBX_API: "https://env.test" },
    );
    expect(config).toEqual({ apiUrl: "https://flag.test", apiKey: "flagkey" });
  });

  test("trims trailing slashes so paths do not double up", () => {
    expect(resolveConfig({ api: "https://x.test///" }, { LBX_KEY: "k" }).apiUrl).toBe(
      "https://x.test",
    );
  });

  test("a missing key is a usage error, not a 401 round-trip", () => {
    expect(() => resolveConfig({}, {})).toThrow(UsageError);
    expect(() => resolveConfig({}, { LBX_KEY: "" })).toThrow("No API key");
  });

  test("rejects a base URL that is not http(s)", () => {
    expect(() => resolveConfig({ api: "ftp://x.test" }, { LBX_KEY: "k" })).toThrow(
      "must be an http(s) URL",
    );
  });

  test("refuses plain http without --insecure, since the key would go in clear", () => {
    expect(() => resolveConfig({ api: "http://x.test" }, { LBX_KEY: "k" })).toThrow(
      /plain http/,
    );
    expect(resolveConfig({ api: "http://x.test", insecure: true }, { LBX_KEY: "k" }).apiUrl).toBe(
      "http://x.test",
    );
  });
});

describe("key files", () => {
  const files: Record<string, string> = {
    "/keys/one": "lbx_stg_one\n",
    "/keys/crlf": "\uFEFF  lbx_stg_crlf \r\nsecond line\r\n",
    "/keys/empty": "\n\nlbx_stg_late",
  };
  const readFile = (path: string): string => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };

  test("--api-key-file takes the trimmed first line", () => {
    expect(resolveConfig({ apiKeyFile: "/keys/one" }, {}, { readFile }).apiKey).toBe("lbx_stg_one");
  });

  test("copes with a BOM, CRLF and surrounding whitespace", () => {
    expect(resolveConfig({ apiKeyFile: "/keys/crlf" }, {}, { readFile }).apiKey).toBe(
      "lbx_stg_crlf",
    );
  });

  test("an empty first line is an error, not a silently wrong key", () => {
    expect(() => resolveConfig({ apiKeyFile: "/keys/empty" }, {}, { readFile })).toThrow(
      "no key on its first line",
    );
  });

  test("a missing file names the source and the path", () => {
    expect(() => resolveConfig({}, { LBX_KEY_FILE: "/keys/nope" }, { readFile })).toThrow(
      "LBX_KEY_FILE: cannot read /keys/nope: ENOENT",
    );
  });

  test("precedence: --api-key, --api-key-file, LBX_KEY, LBX_KEY_FILE", () => {
    const env = { LBX_KEY: "lbx_stg_env", LBX_KEY_FILE: "/keys/one" };
    expect(resolveConfig({ apiKey: "lbx_stg_flag", }, env, { readFile }).apiKey).toBe("lbx_stg_flag");
    expect(resolveConfig({ apiKeyFile: "/keys/crlf" }, env, { readFile }).apiKey).toBe("lbx_stg_crlf");
    expect(resolveConfig({}, env, { readFile }).apiKey).toBe("lbx_stg_env");
    expect(resolveConfig({}, { LBX_KEY_FILE: "/keys/one" }, { readFile }).apiKey).toBe("lbx_stg_one");
  });

  test("--api-key and --api-key-file together is ambiguous", () => {
    expect(() =>
      resolveConfig({ apiKey: "a", apiKeyFile: "/keys/one" }, {}, { readFile }),
    ).toThrow(UsageError);
  });

  test("the no-key message points at the file options", () => {
    expect(() => resolveConfig({}, {})).toThrow("LBX_KEY_FILE");
  });
});

describe("maskKey", () => {
  test("keeps only the prefix and tail", () => {
    expect(maskKey("lbx_stg_abcdefghijkl")).toBe("lbx_stg_…ijkl");
  });

  test("hides a short key completely", () => {
    expect(maskKey("short")).toBe("…");
  });
});
