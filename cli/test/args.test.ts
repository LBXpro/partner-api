import { describe, expect, test } from "bun:test";
import {
  camelCase,
  getBoolean,
  getInteger,
  getList,
  getNumber,
  getString,
  kebab,
  parseArgs,
} from "../src/args.ts";
import { UsageError } from "../src/errors.ts";

describe("parseArgs", () => {
  test("separates positionals from flags", () => {
    const { positionals, flags } = parseArgs(["companies", "get", "anthropic"]);
    expect(positionals).toEqual(["companies", "get", "anthropic"]);
    expect(flags).toEqual({});
  });

  test("reads --flag value and --flag=value alike", () => {
    expect(parseArgs(["--search", "acme"]).flags).toEqual({ search: "acme" });
    expect(parseArgs(["--search=acme"]).flags).toEqual({ search: "acme" });
  });

  test("--flag= yields an empty string, not a boolean", () => {
    expect(parseArgs(["--search="]).flags).toEqual({ search: "" });
  });

  test("camel-cases kebab flag names", () => {
    expect(parseArgs(["--sort-by", "price"]).flags).toEqual({ sortBy: "price" });
    expect(parseArgs(["--min-valuation=10"]).flags).toEqual({ minValuation: "10" });
  });

  test("a bare flag before another flag is boolean true", () => {
    expect(parseArgs(["--json", "--limit", "5"]).flags).toEqual({
      json: true,
      limit: "5",
    });
  });

  test("--no-x sets x to false", () => {
    expect(parseArgs(["--no-in-lbx25"]).flags).toEqual({ inLbx25: false });
  });

  test("repeating a flag collects an array", () => {
    expect(parseArgs(["--industry", "SaaS", "--industry", "FinTech"]).flags).toEqual({
      industry: ["SaaS", "FinTech"],
    });
  });

  test("repeating three times keeps every value in order", () => {
    const { flags } = parseArgs([
      "--industry=a",
      "--industry=b",
      "--industry=c",
    ]);
    expect(flags.industry).toEqual(["a", "b", "c"]);
  });

  test("-- stops parsing and passes the rest through", () => {
    const { positionals, flags } = parseArgs(["orders", "--", "--not-a-flag"]);
    expect(positionals).toEqual(["orders", "--not-a-flag"]);
    expect(flags).toEqual({});
  });

  test("negative numbers are values, not flags", () => {
    expect(parseArgs(["--min-premium", "-25"]).flags).toEqual({ minPremium: "-25" });
  });

  test("declared boolean flags do not swallow the next word", () => {
    const { positionals, flags } = parseArgs(["--help", "companies"]);
    expect(flags).toEqual({ help: true });
    expect(positionals).toEqual(["companies"]);
  });

  test("declared boolean flags still accept an explicit literal", () => {
    expect(parseArgs(["--in-lbx25", "false"]).flags).toEqual({ inLbx25: "false" });
  });

  test("the boolean list is configurable", () => {
    const { flags, positionals } = parseArgs(["--verbose", "x"], {
      booleans: ["verbose"],
    });
    expect(flags).toEqual({ verbose: true });
    expect(positionals).toEqual(["x"]);
  });

  test("rejects a malformed flag", () => {
    expect(() => parseArgs(["--=oops"])).toThrow(UsageError);
  });
});

describe("flag accessors", () => {
  test("getString returns the value or undefined", () => {
    expect(getString({ a: "x" }, "a")).toBe("x");
    expect(getString({}, "a")).toBeUndefined();
  });

  test("getString rejects a boolean or a repeat", () => {
    expect(() => getString({ a: true }, "a")).toThrow("--a needs a value");
    expect(() => getString({ a: ["x", "y"] }, "a")).toThrow("more than once");
  });

  test("getString reports the kebab spelling the user typed", () => {
    expect(() => getString({ sortBy: true }, "sortBy")).toThrow("--sort-by needs a value");
  });

  test("getList always yields an array", () => {
    expect(getList({ a: "x" }, "a")).toEqual(["x"]);
    expect(getList({ a: ["x", "y"] }, "a")).toEqual(["x", "y"]);
    expect(getList({}, "a")).toBeUndefined();
  });

  test("getNumber parses and validates", () => {
    expect(getNumber({ a: "12.5" }, "a")).toBe(12.5);
    expect(getNumber({ a: "-3" }, "a")).toBe(-3);
    expect(() => getNumber({ a: "abc" }, "a")).toThrow("must be a number");
    expect(() => getNumber({ a: "" }, "a")).toThrow("must be a number");
  });

  test("getInteger rejects fractions", () => {
    expect(getInteger({ a: "5" }, "a")).toBe(5);
    expect(() => getInteger({ a: "5.5" }, "a")).toThrow("whole number");
  });

  test("getBoolean accepts flags and literals", () => {
    expect(getBoolean({ a: true }, "a")).toBe(true);
    expect(getBoolean({ a: false }, "a")).toBe(false);
    expect(getBoolean({ a: "true" }, "a")).toBe(true);
    expect(getBoolean({ a: "NO" }, "a")).toBe(false);
    expect(getBoolean({ a: "1" }, "a")).toBe(true);
    expect(getBoolean({}, "a")).toBeUndefined();
    expect(() => getBoolean({ a: "maybe" }, "a")).toThrow("must be true or false");
  });
});

describe("name helpers", () => {
  test("camelCase and kebab round-trip", () => {
    expect(camelCase("sort-by")).toBe("sortBy");
    expect(camelCase("in-lbx25")).toBe("inLbx25");
    expect(kebab("sortBy")).toBe("sort-by");
  });
});
