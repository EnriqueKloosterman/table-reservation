import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/modules/auth/password.js";

const HASH_FORMAT = /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/;

describe("password hashing", () => {
  it("produces a self-describing scrypt hash", async () => {
    expect(await hashPassword("pw")).toMatch(HASH_FORMAT);
  });

  it("uses a random salt", async () => {
    expect(await hashPassword("pw")).not.toBe(await hashPassword("pw"));
  });

  it("verifies the correct password", async () => {
    expect(await verifyPassword("pw", await hashPassword("pw"))).toBe(true);
  });

  it("refuses a wrong password", async () => {
    expect(await verifyPassword("wrong", await hashPassword("pw"))).toBe(false);
  });

  it.each([
    "",
    "not-a-hash",
    "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
    "scrypt$abc$8$1$c2FsdA==$aGFzaA==",
    "scrypt$16384$8$1$c2FsdA==",
    "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
  ])("returns false for malformed stored hash %j", async (stored) => {
    await expect(verifyPassword("pw", stored)).resolves.toBe(false);
  });

  it("handles a 1024-char password", async () => {
    const long = "p".repeat(1024);
    expect(await verifyPassword(long, await hashPassword(long))).toBe(true);
  });
});
