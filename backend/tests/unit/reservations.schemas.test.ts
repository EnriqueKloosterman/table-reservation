import { describe, expect, it } from "vitest";
import { CreateReservationBodySchema } from "../../src/modules/reservations/reservations.schemas.js";
import { zodIssuesToDetails } from "../../src/shared/validation/zod-issues.js";

const valid = {
  date: "2026-11-14",
  time: "20:30",
  partySize: 3,
  name: "Ana García",
  email: "ana@mail.com",
  phone: "+34 600 123 456",
};

function parse(over: Record<string, unknown>) {
  return CreateReservationBodySchema.safeParse({ ...valid, ...over });
}

function fieldsOf(over: Record<string, unknown>): string[] {
  const result = parse(over);
  if (result.success) return [];
  return zodIssuesToDetails(result.error).map((d) => d.field);
}

describe("CreateReservationBody", () => {
  it("accepts a valid body and returns the normalized values", () => {
    const result = CreateReservationBodySchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(valid);
  });

  it("is strict: an unknown field is refused", () => {
    const result = parse({ tableId: "abc" });
    expect(result.success).toBe(false);
    expect(zodIssuesToDetails(result.error!)).toEqual([{ field: "tableId", reason: "Unknown field" }]);
  });

  it("requires every field, naming each missing one", () => {
    const result = CreateReservationBodySchema.safeParse({});
    expect(result.success).toBe(false);
    expect(zodIssuesToDetails(result.error!).map((d) => d.field).sort()).toEqual([
      "date",
      "email",
      "name",
      "partySize",
      "phone",
      "time",
    ]);
  });

  describe("date and time", () => {
    it.each(["2026-02-30", "2026-13-01", "26-11-14", "2026-11-14T10:00", "", "tomorrow"])(
      "refuses date %j",
      (date) => expect(fieldsOf({ date })).toEqual(["date"]),
    );
    it.each(["24:00", "7:30", "20:60", "20:30:00", "", "8pm"])("refuses time %j", (time) =>
      expect(fieldsOf({ time })).toEqual(["time"]),
    );
    it.each(["00:00", "23:59"])("accepts time %s", (time) => expect(parse({ time }).success).toBe(true));
  });

  describe("partySize", () => {
    it.each([1, 50])("accepts the integer %i", (partySize) =>
      expect(parse({ partySize }).success).toBe(true),
    );
    it.each([["0", 0], ["51", 51], ["-1", -1], ["a string", "3"], ["a decimal", 3.5], ["null", null], ["an array", [3]]])(
      "refuses %s",
      (_label, partySize) => expect(fieldsOf({ partySize })).toEqual(["partySize"]),
    );
  });

  describe("name", () => {
    it("is trimmed", () => {
      expect(parse({ name: "  Ana  " }).data?.name).toBe("Ana");
    });
    it.each([["empty", ""], ["spaces", "   "], ["101 characters", "x".repeat(101)], ["a number", 5]])(
      "refuses %s",
      (_l, name) => expect(fieldsOf({ name })).toEqual(["name"]),
    );
    it("accepts exactly 100 characters after trimming", () => {
      expect(parse({ name: ` ${"x".repeat(100)} ` }).success).toBe(true);
    });
  });

  describe("email", () => {
    it("is trimmed and lowercased", () => {
      expect(parse({ email: "  Ana@Mail.COM " }).data?.email).toBe("ana@mail.com");
    });
    it.each([
      ["no at sign", "ana.mail.com"],
      ["no domain", "ana@"],
      ["a display name", "Ana <ana@mail.com>"],
      ["a list of two", "a@mail.com,b@mail.com"],
      ["a list with a space", "a@mail.com b@mail.com"],
      ["empty", ""],
      ["spaces only", "   "],
      ["254+ characters", `${"a".repeat(250)}@mail.com`],
    ])("refuses %s", (_l, email) => expect(fieldsOf({ email })).toEqual(["email"]));
    it("accepts an address of up to 254 characters", () => {
      const local = "a".repeat(64);
      const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`; // 64 + 1 + 189 = 254
      const email = `${local}@${domain}`;
      expect(email).toHaveLength(254);
      expect(parse({ email }).success).toBe(true);
    });
  });

  describe("phone", () => {
    it("is trimmed", () => {
      expect(parse({ phone: "  +34 600 123 456 " }).data?.phone).toBe("+34 600 123 456");
    });
    it.each(["1234567", "(91) 234-5678", "+1 (555) 123-4567", "600 123 456"])("accepts %j", (phone) =>
      expect(parse({ phone }).success).toBe(true),
    );
    it.each([
      ["letters", "abc1234567"],
      ["letters mixed in", "600-123-45x"],
      ["6 digits", "123456"],
      ["6 digits with separators", "12 34 56"],
      ["a plus in the middle", "600+123456"],
      ["a double plus", "++34600123456"],
      ["21 characters", "1".repeat(21)],
      ["empty", ""],
      ["spaces only", "       "],
      ["a dot", "600.123.456"],
    ])("refuses %s", (_l, phone) => expect(fieldsOf({ phone })).toEqual(["phone"]));
  });

  it("reports every offending field at once", () => {
    const result = CreateReservationBodySchema.safeParse({
      ...valid,
      name: "",
      email: "nope",
      phone: "12",
      partySize: 0,
      date: "2026-02-30",
      time: "99:00",
    });
    expect(result.success).toBe(false);
    expect(zodIssuesToDetails(result.error!).map((d) => d.field).sort()).toEqual([
      "date",
      "email",
      "name",
      "partySize",
      "phone",
      "time",
    ]);
  });
});

describe("CreateReservationBody: lengths are UTF-16 code units (contract §POST /reservations, CHK010)", () => {
  it("counts an emoji as two units: 50 emoji fit a 100-unit name, 51 do not", () => {
    expect(parse({ name: "😀".repeat(50) }).success).toBe(true);
    expect(fieldsOf({ name: "😀".repeat(51) })).toEqual(["name"]);
  });

  it("counts accented characters as one unit", () => {
    expect(parse({ name: "é".repeat(100) }).success).toBe(true);
    expect(fieldsOf({ name: "é".repeat(101) })).toEqual(["name"]);
  });
});

describe("the documented request example", () => {
  it("passes the body schema unchanged", async () => {
    const { CREATE_RESERVATION_EXAMPLE } = await import("../../src/modules/reservations/reservations.schemas.js");
    const result = CreateReservationBodySchema.safeParse(CREATE_RESERVATION_EXAMPLE);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(CREATE_RESERVATION_EXAMPLE);
  });
});
