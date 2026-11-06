import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseDuration } from "../../src/config/env.js";

const base = {
  MONGODB_URI: "mongodb://localhost:27017/test",
  JWT_SECRET: "x".repeat(32),
  RESTAURANT_TIME_ZONE: "UTC",
};

function configErrorKeys(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return [...(err as ConfigError).keys].sort();
  }
  throw new Error("loadConfig did not throw");
}

describe("parseDuration", () => {
  it.each([
    ["8h", 28800],
    ["30s", 30],
    ["15m", 900],
    ["2d", 172800],
  ])("parses %s as %i seconds", (input, seconds) => {
    expect(parseDuration(input)).toBe(seconds);
  });

  it.each(["8", "h", "1.5h", "8w"])("refuses %s", (input) => {
    expect(() => parseDuration(input)).toThrow();
  });
});

describe("loadConfig", () => {
  it("returns a typed config with defaults", () => {
    const config = loadConfig({ ...base });
    expect(config).toEqual({
      MONGODB_URI: base.MONGODB_URI,
      JWT_SECRET: base.JWT_SECRET,
      JWT_EXPIRES_IN: "8h",
      jwtExpiresInSeconds: 28800,
      RESTAURANT_TIME_ZONE: "UTC",
      CORS_ORIGINS: ["http://localhost:5173"],
      PORT: 3000,
    });
  });

  it("reads explicit values", () => {
    const config = loadConfig({
      ...base,
      JWT_EXPIRES_IN: "15m",
      RESTAURANT_TIME_ZONE: "Europe/Madrid",
      PORT: "8080",
    });
    expect(config.jwtExpiresInSeconds).toBe(900);
    expect(config.RESTAURANT_TIME_ZONE).toBe("Europe/Madrid");
    expect(config.PORT).toBe(8080);
  });

  it("refuses a JWT_SECRET shorter than 32 chars", () => {
    expect(configErrorKeys({ ...base, JWT_SECRET: "x".repeat(31) })).toEqual(["JWT_SECRET"]);
  });

  it("refuses an unknown time zone", () => {
    expect(configErrorKeys({ ...base, RESTAURANT_TIME_ZONE: "Mars/Olympus" })).toEqual([
      "RESTAURANT_TIME_ZONE",
    ]);
  });

  it("refuses a missing MONGODB_URI", () => {
    expect(configErrorKeys({ ...base, MONGODB_URI: undefined })).toEqual(["MONGODB_URI"]);
  });

  it.each(["0", "70000"])("refuses PORT %s", (port) => {
    expect(configErrorKeys({ ...base, PORT: port })).toEqual(["PORT"]);
  });

  it("refuses a non-URL CORS_ORIGINS entry", () => {
    expect(configErrorKeys({ ...base, CORS_ORIGINS: "http://a.test,not a url" })).toEqual([
      "CORS_ORIGINS",
    ]);
  });

  it("refuses an invalid JWT_EXPIRES_IN", () => {
    expect(configErrorKeys({ ...base, JWT_EXPIRES_IN: "8w" })).toEqual(["JWT_EXPIRES_IN"]);
  });

  it("trims CORS_ORIGINS entries and drops empty ones", () => {
    const config = loadConfig({ ...base, CORS_ORIGINS: "http://a.test, ,http://b.test" });
    expect(config.CORS_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });

  it("lists every invalid key in one error", () => {
    expect(
      configErrorKeys({
        MONGODB_URI: undefined,
        JWT_SECRET: "short",
        RESTAURANT_TIME_ZONE: "Mars/Olympus",
        PORT: "0",
        CORS_ORIGINS: "nope",
      }),
    ).toEqual(["CORS_ORIGINS", "JWT_SECRET", "MONGODB_URI", "PORT", "RESTAURANT_TIME_ZONE"]);
  });
});
