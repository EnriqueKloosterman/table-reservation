import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Feature 004 (research R9): the read path cannot write, claim, notify or touch the secret code,
// and that is checkable from its imports alone.
const FILE = fileURLToPath(
  new URL("../../src/modules/reservations/reservations.read.service.ts", import.meta.url),
);
const source = readFileSync(FILE, "utf8");

/** Every module specifier the file imports (static, type-only, re-export or dynamic). */
function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) found.push(m[1]!);
  for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1]!);
  for (const m of text.matchAll(/\bimport\s+["']([^"']+)["']/g)) found.push(m[1]!);
  return found;
}

describe("reservations.read.service.ts is read-only by construction", () => {
  it("exports both read operations (the surface this guard protects)", () => {
    expect(source).toMatch(/export\s+(async\s+)?function\s+listDay\b/);
    expect(source).toMatch(/export\s+(async\s+)?function\s+readReservation\b/);
  });

  it("has imports to inspect", () => {
    expect(specifiers(source).length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    "calendar.model",
    "interval-claims",
    "reservations.ops",
    "notifier",
    "email-sender",
    "reservations.service",
    "secret-code",
  ])("does not import %s", (forbidden) => {
    const offending = specifiers(source).filter((s) => s.includes(forbidden));
    expect(offending).toEqual([]);
  });

  it("never references the secret code, its hash, or a hash-revealing select", () => {
    expect(source).not.toContain("secretCodeHash");
    expect(source).not.toContain("secretCode");
    expect(source).not.toContain('select("+');
    expect(source).not.toContain("select('+");
  });
});
