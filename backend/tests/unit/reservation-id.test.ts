import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import {
  parseReservationId,
  RESERVATION_NOT_FOUND_MESSAGE,
} from "../../src/modules/reservations/reservation-id.js";

describe("parseReservationId", () => {
  it.each(["6741a0ffee0123456789abcd", "6741A0FFEE0123456789ABCD"])("accepts 24 hex characters %s", (id) => {
    const parsed = parseReservationId(id);
    expect(parsed).not.toBeNull();
    expect(parsed).toBeInstanceOf(Types.ObjectId);
    expect(parsed!.toHexString()).toBe(id.toLowerCase());
  });

  it.each([
    ["a short word", "abc"],
    ["23 hex characters", "6741a0ffee0123456789abc"],
    ["25 hex characters", "6741a0ffee0123456789abcde"],
    ["the empty string", ""],
    ["a single space", " "],
    ["24 characters with a non-hex one", "6741a0ffee0123456789abcg"],
    ["leading whitespace", " 6741a0ffee0123456789abc"],
    ["trailing whitespace", "6741a0ffee0123456789abc "],
    ["surrounding whitespace on a valid id", " 6741a0ffee0123456789abcd "],
    ["a trailing newline", "6741a0ffee0123456789abcd\n"],
  ])("returns null for %s", (_label, id) => {
    expect(parseReservationId(id)).toBeNull();
  });

  it("exports the exact not-found message", () => {
    expect(RESERVATION_NOT_FOUND_MESSAGE).toBe("Reservation not found");
  });
});
