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
      RESERVATION_DURATION_MINUTES: 120,
      TIME_SLOT_INTERVAL_MINUTES: 15,
      MIN_NOTICE_MINUTES: 60,
      BOOKING_HORIZON_DAYS: 60,
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

describe("loadConfig: booking rules (feature 002, research R1)", () => {
  const keys = [
    ["RESERVATION_DURATION_MINUTES", 120, 15, 480],
    ["TIME_SLOT_INTERVAL_MINUTES", 15, 5, 120],
    ["MIN_NOTICE_MINUTES", 60, 0, 1440],
    ["BOOKING_HORIZON_DAYS", 60, 1, 365],
  ] as const;

  describe.each(keys)("%s", (key, defaultValue, min, max) => {
    it(`defaults to ${defaultValue}`, () => {
      expect(loadConfig({ ...base })[key]).toBe(defaultValue);
    });

    it("parses an integer string at both bounds as a number", () => {
      expect(loadConfig({ ...base, [key]: String(min) })[key]).toBe(min);
      expect(loadConfig({ ...base, [key]: String(max) })[key]).toBe(max);
    });

    it.each(["-1", "1.5", "abc", "", " ", "12abc", "1e2"])("refuses %j", (value) => {
      expect(configErrorKeys({ ...base, [key]: value })).toEqual([key]);
    });

    it("refuses a value below the minimum", () => {
      if (min === 0) return; // 0 is the minimum and is valid for this key
      expect(configErrorKeys({ ...base, [key]: String(min - 1) })).toEqual([key]);
    });

    it("refuses a value above the maximum", () => {
      expect(configErrorKeys({ ...base, [key]: String(max + 1) })).toEqual([key]);
    });

    it("reports a clear message for a non-numeric value", () => {
      try {
        loadConfig({ ...base, [key]: "nope" });
      } catch (err) {
        const issue = (err as ConfigError).issues.find((i) => i.key === key);
        expect(issue?.message).toMatch(/whole number/i);
        return;
      }
      throw new Error("loadConfig did not throw");
    });
  });

  it("accepts MIN_NOTICE_MINUTES=0 (no minimum notice) but refuses 0 for the other keys", () => {
    expect(loadConfig({ ...base, MIN_NOTICE_MINUTES: "0" }).MIN_NOTICE_MINUTES).toBe(0);
    for (const key of [
      "RESERVATION_DURATION_MINUTES",
      "TIME_SLOT_INTERVAL_MINUTES",
      "BOOKING_HORIZON_DAYS",
    ]) {
      expect(configErrorKeys({ ...base, [key]: "0" })).toEqual([key]);
    }
  });

  it("refuses values larger than 1440 for the duration and the slot interval", () => {
    expect(configErrorKeys({ ...base, TIME_SLOT_INTERVAL_MINUTES: "1441" })).toEqual([
      "TIME_SLOT_INTERVAL_MINUTES",
    ]);
    expect(configErrorKeys({ ...base, RESERVATION_DURATION_MINUTES: "1441" })).toEqual([
      "RESERVATION_DURATION_MINUTES",
    ]);
  });

  it("lists every invalid booking key in one error", () => {
    expect(
      configErrorKeys({
        ...base,
        RESERVATION_DURATION_MINUTES: "x",
        TIME_SLOT_INTERVAL_MINUTES: "0",
        MIN_NOTICE_MINUTES: "-5",
        BOOKING_HORIZON_DAYS: "999",
      }),
    ).toEqual([
      "BOOKING_HORIZON_DAYS",
      "MIN_NOTICE_MINUTES",
      "RESERVATION_DURATION_MINUTES",
      "TIME_SLOT_INTERVAL_MINUTES",
    ]);
  });
});
