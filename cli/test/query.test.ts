import { describe, expect, test } from "bun:test";
import { buildQuery } from "../src/query.ts";

describe("buildQuery", () => {
  test("returns an empty string when nothing is set", () => {
    expect(buildQuery({})).toBe("");
    expect(buildQuery({ a: undefined, b: null })).toBe("");
  });

  test("serializes scalars", () => {
    expect(buildQuery({ limit: 5, search: "acme", inLBX25: true })).toBe(
      "?limit=5&search=acme&inLBX25=true",
    );
  });

  test("keeps 0 and false, which are meaningful bounds", () => {
    expect(buildQuery({ minPremium: 0, inLBX25: false })).toBe(
      "?minPremium=0&inLBX25=false",
    );
  });

  test("repeats the key for array values", () => {
    expect(buildQuery({ industry: ["SaaS", "FinTech"] })).toBe(
      "?industry=SaaS&industry=FinTech",
    );
  });

  test("drops an empty array entirely", () => {
    expect(buildQuery({ industry: [] })).toBe("");
  });

  test("percent-encodes spaces and specials", () => {
    expect(buildQuery({ industry: "HR Tech" })).toBe("?industry=HR+Tech");
    expect(buildQuery({ search: "a&b=c" })).toBe("?search=a%26b%3Dc");
  });
});
