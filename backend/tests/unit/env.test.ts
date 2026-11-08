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
      EMAIL_TIMEOUT_MS: 10000,
      RESTAURANT_NAME: "the restaurant",
      CANCEL_LINK_BASE_URL: "http://localhost:5173/cancel",
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

describe("loadConfig: email and cancellation link (feature 003, research R10)", () => {
  describe("SMTP_URL and EMAIL_FROM", () => {
    it("is optional: absent, the config has no SMTP_URL and EMAIL_FROM is ignored", () => {
      const config = loadConfig({ ...base, EMAIL_FROM: "not even checked" });
      expect(config.SMTP_URL).toBeUndefined();
    });

    it("treats an empty SMTP_URL as unset", () => {
      const config = loadConfig({ ...base, SMTP_URL: "" });
      expect(config.SMTP_URL).toBeUndefined();
    });

    it.each(["smtp://mail.test:25", "smtps://user:pw@mail.test:465"])("accepts %s", (url) => {
      const config = loadConfig({ ...base, SMTP_URL: url, EMAIL_FROM: "noreply@resto.test" });
      expect(config.SMTP_URL).toBe(url);
    });

    it.each(["http://mail.test", "mail.test", "not a url", "ftp://mail.test"])("refuses SMTP_URL %j", (url) => {
      expect(configErrorKeys({ ...base, SMTP_URL: url, EMAIL_FROM: "noreply@resto.test" })).toEqual(["SMTP_URL"]);
    });

    it("requires EMAIL_FROM when SMTP_URL is set, reporting EMAIL_FROM", () => {
      expect(configErrorKeys({ ...base, SMTP_URL: "smtp://mail.test" })).toEqual(["EMAIL_FROM"]);
      expect(configErrorKeys({ ...base, SMTP_URL: "smtp://mail.test", EMAIL_FROM: "" })).toEqual(["EMAIL_FROM"]);
    });

    it.each(["a@b.c", "La Mesa <noreply@resto.test>"])("accepts EMAIL_FROM %j", (from) => {
      const config = loadConfig({ ...base, SMTP_URL: "smtp://mail.test", EMAIL_FROM: from });
      expect(config.EMAIL_FROM).toBe(from);
    });

    it.each(["nobody", "a@b", "@b.c", "Name <nope>", "a@b.c\nBcc: x@y.z", "a@b.c\r"])(
      "refuses EMAIL_FROM %j",
      (from) => {
        expect(configErrorKeys({ ...base, SMTP_URL: "smtp://mail.test", EMAIL_FROM: from })).toEqual(["EMAIL_FROM"]);
      },
    );
  });

  describe("EMAIL_TIMEOUT_MS", () => {
    it("defaults to 10000", () => {
      expect(loadConfig({ ...base }).EMAIL_TIMEOUT_MS).toBe(10000);
    });

    it("accepts both bounds", () => {
      expect(loadConfig({ ...base, EMAIL_TIMEOUT_MS: "100" }).EMAIL_TIMEOUT_MS).toBe(100);
      expect(loadConfig({ ...base, EMAIL_TIMEOUT_MS: "120000" }).EMAIL_TIMEOUT_MS).toBe(120000);
    });

    it.each(["99", "120001", "1.5", "", "abc", "-1", "1e3"])("refuses %j naming the key", (value) => {
      expect(configErrorKeys({ ...base, EMAIL_TIMEOUT_MS: value })).toEqual(["EMAIL_TIMEOUT_MS"]);
    });
  });

  describe("RESTAURANT_NAME", () => {
    it("defaults to 'the restaurant'", () => {
      expect(loadConfig({ ...base }).RESTAURANT_NAME).toBe("the restaurant");
    });

    it("is trimmed", () => {
      expect(loadConfig({ ...base, RESTAURANT_NAME: "  La Mesa  " }).RESTAURANT_NAME).toBe("La Mesa");
    });

    it("accepts 1 and 100 characters", () => {
      expect(loadConfig({ ...base, RESTAURANT_NAME: "x" }).RESTAURANT_NAME).toBe("x");
      expect(loadConfig({ ...base, RESTAURANT_NAME: "x".repeat(100) }).RESTAURANT_NAME).toHaveLength(100);
    });

    it.each(["", "   ", "x".repeat(101), "La\nMesa", "La\rMesa"])("refuses %j", (value) => {
      expect(configErrorKeys({ ...base, RESTAURANT_NAME: value })).toEqual(["RESTAURANT_NAME"]);
    });
  });

  describe("CANCEL_LINK_BASE_URL", () => {
    it("defaults to http://localhost:5173/cancel", () => {
      expect(loadConfig({ ...base }).CANCEL_LINK_BASE_URL).toBe("http://localhost:5173/cancel");
    });

    it.each(["https://resto.test/cancel", "http://localhost:5173/cancel"])("accepts %s", (url) => {
      expect(loadConfig({ ...base, CANCEL_LINK_BASE_URL: url }).CANCEL_LINK_BASE_URL).toBe(url);
    });

    it.each(["ftp://resto.test/cancel", "resto.test/cancel", "not a url", "", "https://resto.test/cancel#x", "https://resto.test/cancel#"])(
      "refuses %j",
      (url) => {
        expect(configErrorKeys({ ...base, CANCEL_LINK_BASE_URL: url })).toEqual(["CANCEL_LINK_BASE_URL"]);
      },
    );
  });

  it("never echoes SMTP_URL (it may hold credentials) in a configuration error", () => {
    try {
      loadConfig({ ...base, SMTP_URL: "smtp://user:s3cret@mail.test" });
    } catch (err) {
      const text = JSON.stringify((err as ConfigError).issues) + (err as ConfigError).message;
      expect(text).not.toContain("s3cret");
      return;
    }
    throw new Error("loadConfig did not throw");
  });
});
