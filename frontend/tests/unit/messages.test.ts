import { describe, expect, it } from "vitest";
import type { components } from "../../src/api/schema";
import {
  AVAILABILITY_MESSAGES,
  CLIENT_MESSAGES,
  CONFLICT_MESSAGES,
  ERROR_CODE_MESSAGES,
  FIELD_PROBLEMS,
  GENERIC_MESSAGE,
  messageForAvailability,
  messageForCode,
  messageForConflict,
  type Message,
} from "../../src/api/messages";

type AvailabilityReason = components["schemas"]["AvailabilityReason"];
type ConflictReason = components["schemas"]["ConflictReason"];
type ErrorCode = components["schemas"]["ErrorResponse"]["error"]["code"];

const AVAILABILITY: AvailabilityReason[] = [
  "too_soon",
  "too_far_ahead",
  "closed_date",
  "closed_day",
  "outside_service_hours",
  "party_too_large",
  "no_table_free",
];
const CONFLICT: ConflictReason[] = ["duplicate_reservation", "table_has_upcoming_reservations"];
const CODES: ErrorCode[] = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_REQUIRED",
  "INVALID_CREDENTIALS",
  "NOT_FOUND",
  "CONFLICT",
  "NO_AVAILABILITY",
  "ALREADY_CANCELLED",
  "CANNOT_CANCEL",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
];
const ENUM_STRINGS: string[] = [...AVAILABILITY, ...CONFLICT, ...CODES];

function text(m: Message): string {
  return [m.title, m.body, m.next ?? ""].join(" ");
}

function allMessages(): Message[] {
  return [
    ...Object.values(AVAILABILITY_MESSAGES),
    ...Object.values(CONFLICT_MESSAGES),
    ...Object.values(ERROR_CODE_MESSAGES),
    GENERIC_MESSAGE,
    ...Object.values(CLIENT_MESSAGES),
  ];
}

describe("message catalog", () => {
  it.each(AVAILABILITY)("has a message for availability reason %s", (reason) => {
    const m = AVAILABILITY_MESSAGES[reason];
    expect(m.title.length).toBeGreaterThan(0);
    expect(m.body.length).toBeGreaterThan(0);
  });

  it.each(CONFLICT)("has a message for conflict reason %s", (reason) => {
    const m = CONFLICT_MESSAGES[reason];
    expect(m.title.length).toBeGreaterThan(0);
    expect(m.body.length).toBeGreaterThan(0);
  });

  it.each(CODES)("has a message for error code %s", (code) => {
    const m = ERROR_CODE_MESSAGES[code];
    expect(m.title.length).toBeGreaterThan(0);
    expect(m.body.length).toBeGreaterThan(0);
  });

  it("keeps all availability messages pairwise distinct", () => {
    const texts = AVAILABILITY.map((r) => text(AVAILABILITY_MESSAGES[r]));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("falls back to the generic message for unknown values", () => {
    expect(messageForAvailability("brand_new")).toBe(GENERIC_MESSAGE);
    expect(messageForConflict("brand_new")).toBe(GENERIC_MESSAGE);
    expect(messageForCode("BRAND_NEW")).toBe(GENERIC_MESSAGE);
  });

  it("returns the catalog entry for known values", () => {
    expect(messageForAvailability("closed_day")).toBe(AVAILABILITY_MESSAGES.closed_day);
    expect(messageForConflict("duplicate_reservation")).toBe(
      CONFLICT_MESSAGES.duplicate_reservation,
    );
    expect(messageForCode("NOT_FOUND")).toBe(ERROR_CODE_MESSAGES.NOT_FOUND);
  });

  it("never exposes codes, numbers, paths or braces", () => {
    for (const m of allMessages()) {
      const t = text(m);
      expect(t).not.toMatch(/\b\d{3}\b/);
      expect(t).not.toContain("/");
      expect(t).not.toContain("{");
      expect(t).not.toContain("_");
      for (const value of ENUM_STRINGS) expect(t).not.toContain(value);
    }
  });

  it("has a field problem for every field and the unknown-field form message", () => {
    for (const key of ["date", "partySize", "name", "email", "phone", "code", "form"] as const) {
      expect(FIELD_PROBLEMS[key].length).toBeGreaterThan(0);
    }
    expect(FIELD_PROBLEMS.form).toBe("Please check the details and try again.");
  });

  it("uses the exact copy of contracts/messages.md for client-side conditions", () => {
    expect(CLIENT_MESSAGES.timesServerError.title).toBe("We couldn't load the available times.");
    expect(CLIENT_MESSAGES.createServerError.title).toBe(
      "Your reservation couldn't be completed.",
    );
    expect(CLIENT_MESSAGES.createServerError.next).toBe("Check your email before trying again.");
    expect(CLIENT_MESSAGES.timesUnreachable.title).toBe("We can't reach the server right now.");
    expect(CLIENT_MESSAGES.createUnreachable.title).toBe(
      "We don't know whether your reservation was made. A confirmation email may already be on its way.",
    );
    expect(CLIENT_MESSAGES.cancelTemporary.title).toBe(
      "We couldn't complete the cancellation just now.",
    );
    expect(CLIENT_MESSAGES.config.title).toBe("This service isn't available right now.");
    expect(CLIENT_MESSAGES.config.next).toBe("Please try again later.");
    expect(GENERIC_MESSAGE.title).toBe("Something went wrong.");
    expect(CLIENT_MESSAGES.idlePrompt.title).toBe(
      "Choose a date and a party size to see the available times.",
    );
    expect(CLIENT_MESSAGES.confirmation.title).toBe("Your table is booked");
    expect(CLIENT_MESSAGES.confirmation.body).toBe("We've emailed you how to cancel.");
    expect(CLIENT_MESSAGES.cancelled.title).toBe("Your reservation is cancelled");
    expect(CLIENT_MESSAGES.noTableFreeLeadIn.title).toBe("That time was just taken.");
  });
});
