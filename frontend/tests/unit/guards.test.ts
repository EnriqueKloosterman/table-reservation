import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) && name !== "schema.d.ts" ? [full] : [];
  });
}

const sources = files(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)[^'"\n;]*?\sfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

describe("source guards", () => {
  it("scans some files", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each([
    ["console.", /console\./],
    ["localStorage", /localStorage/],
    ["sessionStorage", /sessionStorage/],
    ["indexedDB", /indexedDB/],
    ["document.cookie", /document\.cookie/],
    ["toISOString", /toISOString/],
    ["Date.now", /Date\.now/],
    ["eslint-disable of restricted rules", /eslint-disable[^\n]*(no-console|no-restricted)/],
  ])("has no %s in src", (_label, pattern) => {
    const offenders = sources.filter((s) => pattern.test(s.text)).map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("never builds a Date from a string", () => {
    const offenders = sources
      .filter((s) => /new Date\((?!\s*\)|\s*Date\.UTC\()/.test(s.text))
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("imports only react, react-dom and relative paths", () => {
    const offenders: string[] = [];
    for (const s of sources) {
      for (const match of s.text.matchAll(IMPORT_RE)) {
        const spec = match[1] ?? match[2] ?? match[3] ?? "";
        const ok =
          spec.startsWith(".") ||
          spec === "react" ||
          spec.startsWith("react/") ||
          spec === "react-dom" ||
          spec.startsWith("react-dom/");
        if (!ok) offenders.push(`${s.path}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has only react and react-dom as runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["react", "react-dom"]);
  });
});
