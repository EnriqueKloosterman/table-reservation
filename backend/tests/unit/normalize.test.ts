import { describe, expect, it } from "vitest";
import { nameKey, normalizeEmail, normalizeName } from "../../src/shared/validation/normalize.js";

describe("normalize", () => {
  it("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail(" Ana@Resto.com ")).toBe("ana@resto.com");
  });

  it("normalizeName trims and keeps case", () => {
    expect(normalizeName("  T1 ")).toBe("T1");
  });

  it("nameKey trims and lowercases", () => {
    expect(nameKey("  T1 ")).toBe("t1");
  });
});
