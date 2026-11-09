import { describe, expect, it } from "vitest";
import { z, type ZodError } from "zod";
import { zodIssuesToDetails } from "../../src/shared/validation/zod-issues.js";

function failure(schema: z.ZodType, input: unknown): ZodError {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected parse failure");
  return result.error;
}

const Period = z.strictObject({ name: z.string().min(1), start: z.string(), end: z.string().min(5) });
const Schedule = z.strictObject({
  days: z.array(z.strictObject({ day: z.string(), periods: z.array(Period) })),
});

describe("zodIssuesToDetails", () => {
  it("joins nested paths with dots for keys and [i] for indexes", () => {
    const err = failure(Schedule, {
      days: [
        { day: "monday", periods: [] },
        { day: "tuesday", periods: [{ name: "Lunch", start: "12:00", end: "x" }] },
      ],
    });
    const details = zodIssuesToDetails(err);
    expect(details).toHaveLength(1);
    expect(details[0]!.field).toBe("days[1].periods[0].end");
    expect(details[0]!.reason).toBe(err.issues[0]!.message);
  });

  it("maps an empty path to body without prefix", () => {
    const err = failure(z.strictObject({ a: z.string() }), []);
    expect(zodIssuesToDetails(err)).toEqual([{ field: "body", reason: err.issues[0]!.message }]);
  });

  it("maps an empty path to the prefix itself for query and params", () => {
    const err = failure(z.strictObject({ a: z.string() }), "nope");
    expect(zodIssuesToDetails(err, "query")[0]!.field).toBe("query");
    expect(zodIssuesToDetails(err, "params")[0]!.field).toBe("params");
  });

  it("applies the prefix to non-empty paths", () => {
    const q = failure(z.strictObject({ includePast: z.enum(["true", "false"]) }), {
      includePast: "yes",
    });
    expect(zodIssuesToDetails(q, "query")[0]!.field).toBe("query.includePast");
    const p = failure(z.strictObject({ date: z.string().length(10) }), { date: "abc" });
    expect(zodIssuesToDetails(p, "params")[0]!.field).toBe("params.date");
  });

  it("does not prefix body fields", () => {
    const err = failure(z.strictObject({ name: z.string() }), { name: 1 });
    expect(zodIssuesToDetails(err)[0]!.field).toBe("name");
  });

  it("produces one 'Unknown field' entry per unrecognized key", () => {
    const top = failure(z.strictObject({ name: z.string() }), { name: "x", color: "red", size: 2 });
    expect(zodIssuesToDetails(top)).toEqual([
      { field: "color", reason: "Unknown field" },
      { field: "size", reason: "Unknown field" },
    ]);

    const nested = failure(Schedule, {
      days: [{ day: "monday", periods: [{ name: "L", start: "12:00", end: "15:00", foo: 1 }] }],
    });
    expect(zodIssuesToDetails(nested)).toEqual([
      { field: "days[0].periods[0].foo", reason: "Unknown field" },
    ]);
  });

  it("returns one entry per issue, in issue order", () => {
    const err = failure(z.strictObject({ name: z.string().min(1), qty: z.number().int() }), {
      name: "",
      qty: 1.5,
    });
    const details = zodIssuesToDetails(err);
    expect(details.map((d) => d.field)).toEqual(err.issues.map((i) => i.path.join(".")));
    expect(details.map((d) => d.reason)).toEqual(err.issues.map((i) => i.message));
    expect(details).toHaveLength(2);
  });
});
