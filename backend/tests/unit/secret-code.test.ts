import { describe, expect, it } from "vitest";
import { generateSecretCode, hashSecretCode } from "../../src/modules/reservations/secret-code.js";

describe("generateSecretCode", () => {
  it("returns 43 base64url characters (256 bits)", () => {
    const code = generateSecretCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(code, "base64url")).toHaveLength(32);
  });

  it("never repeats across many calls", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateSecretCode()));
    expect(codes.size).toBe(1000);
  });
});

describe("hashSecretCode", () => {
  it("returns a SHA-256 hex digest (64 characters)", () => {
    expect(hashSecretCode("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the known SHA-256 of a fixed input", () => {
    expect(hashSecretCode("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic, and differs from the code itself", () => {
    const code = generateSecretCode();
    expect(hashSecretCode(code)).toBe(hashSecretCode(code));
    expect(hashSecretCode(code)).not.toBe(code);
    expect(hashSecretCode(code)).not.toContain(code);
  });

  it("different codes give different hashes", () => {
    expect(hashSecretCode("a")).not.toBe(hashSecretCode("b"));
  });
});
