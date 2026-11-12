import { describe, expect, it } from "vitest";
import {
  validateCode,
  validateDate,
  validateDraft,
  validateEmail,
  validateName,
  validatePartySize,
  validatePhone,
} from "../../src/features/booking/validators";

describe("validateDate", () => {
  it.each(["2026-11-14", "2028-02-29", "1999-01-01"])("accepts %j", (v) => {
    expect(validateDate(v)).toBeUndefined();
  });
  it.each(["", "2026-02-30", "2026-13-01", "14/11/2026", "2026-1-1", " 2026-11-14"])(
    "rejects %j",
    (v) => {
      expect(validateDate(v)).toBe("date");
    },
  );
});

describe("validatePartySize", () => {
  it.each(["1", "2", "50"])("accepts %j", (v) => {
    expect(validatePartySize(v)).toBeUndefined();
  });
  it.each(["0", "51", "2.5", "+2", "-1", "02", "1e1", "", "abc", " 2"])("rejects %j", (v) => {
    expect(validatePartySize(v)).toBe("partySize");
  });
});

describe("validateName", () => {
  it("accepts 1 to 100 characters after trimming", () => {
    expect(validateName("Ana")).toBeUndefined();
    expect(validateName("a".repeat(100))).toBeUndefined();
    expect(validateName("  Ana  ")).toBeUndefined();
  });
  it("rejects blank or too long", () => {
    expect(validateName("   ")).toBe("name");
    expect(validateName("")).toBe("name");
    expect(validateName("a".repeat(101))).toBe("name");
  });
});

describe("validateEmail", () => {
  it("accepts a single address, trimming spaces", () => {
    expect(validateEmail("ana@example.com")).toBeUndefined();
    expect(validateEmail("  ana@example.com ")).toBeUndefined();
  });
  it.each(["A <a@b.co>", "a@b.co, c@d.co", "a b@c.co", "a@", "a@b", "@b.co", "", "plain"])(
    "rejects %j",
    (v) => {
      expect(validateEmail(v)).toBe("email");
    },
  );
  it("rejects more than 254 characters", () => {
    expect(validateEmail(`${"a".repeat(250)}@b.co`)).toBe("email");
  });
});

describe("validatePhone", () => {
  it.each(["+34 600 123 456", "(600) 123-456", "6001234", "600 123 456"])("accepts %j", (v) => {
    expect(validatePhone(v)).toBeUndefined();
  });
  it.each(["123456", "12345678901234567890 1", "600-abc-123", "6+00123456", "", "++3460012345"])(
    "rejects %j",
    (v) => {
      expect(validatePhone(v)).toBe("phone");
    },
  );
});

describe("validateCode", () => {
  it("accepts a non-empty trimmed code", () => {
    expect(validateCode("  ABC ")).toBeUndefined();
  });
  it("rejects blank", () => {
    expect(validateCode("   ")).toBe("code");
    expect(validateCode("")).toBe("code");
  });
});

describe("validateDraft", () => {
  it("returns a catalog key per field and nothing for valid ones", () => {
    const result = validateDraft({
      date: "2026-11-14",
      partySize: "0",
      time: null,
      name: "",
      email: "ana@example.com",
      phone: "x",
    });
    expect(result).toEqual({
      date: undefined,
      time: undefined,
      partySize: "partySize",
      name: "name",
      email: undefined,
      phone: "phone",
    });
  });
});
