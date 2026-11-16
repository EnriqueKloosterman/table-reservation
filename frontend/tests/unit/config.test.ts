import { describe, expect, it } from "vitest";
import { readConfig } from "../../src/config/env";

describe("readConfig", () => {
  it("accepts a plain http origin", () => {
    expect(readConfig("http://localhost:3000")).toEqual({
      ok: true,
      apiBaseUrl: "http://localhost:3000",
    });
  });

  it("removes the trailing slash", () => {
    expect(readConfig("https://api.example.com/")).toEqual({
      ok: true,
      apiBaseUrl: "https://api.example.com",
    });
  });

  it.each([
    undefined,
    "",
    "localhost:3000",
    "ftp://x",
    "http://u:p@x",
    "http://x/path",
    "http://x?a=1",
    "http://x#f",
    "not a url",
  ])("rejects %j", (raw) => {
    const result = readConfig(raw);
    expect(result).toEqual({ ok: false });
    expect(Object.keys(result)).toEqual(["ok"]);
  });
});
