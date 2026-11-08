import { describe, expect, it } from "vitest";
import {
  renderCancellationEmail,
  renderConfirmationEmail,
  type CancellationEmailInput,
  type ConfirmationEmailInput,
} from "../../src/modules/notifications/email-templates.js";

const config = { RESTAURANT_NAME: "La Mesa", CANCEL_LINK_BASE_URL: "http://localhost:5173/cancel" };
const CODE = "k3J9xQ7mV0aB4tYw2uHnR8dLzE5cFgS1pXoI6vMqTaU";

const confirmation: ConfirmationEmailInput = {
  guestName: "Jane Roe",
  date: "2026-11-14",
  startTime: "20:00",
  endTime: "22:00",
  partySize: 4,
  code: CODE,
};
const cancellation: CancellationEmailInput = {
  guestName: "Jane Roe",
  date: "2026-11-14",
  startTime: "20:00",
  endTime: "22:00",
  partySize: 4,
  cancelledBy: "guest",
};

describe("renderConfirmationEmail", () => {
  it("has the fixed subject with only the restaurant name variable", () => {
    const { subject } = renderConfirmationEmail(confirmation, config);
    expect(subject).toBe("Your reservation at La Mesa is confirmed");
  });

  it("never puts guest data or the code in the subject", () => {
    const { subject } = renderConfirmationEmail(
      { ...confirmation, guestName: "Jane Roe", code: CODE },
      config,
    );
    expect(subject).not.toContain("Jane");
    expect(subject).not.toContain(CODE);
    expect(subject).not.toContain("@");
  });

  it("the body has name, local date, start–end time, party size, the fragment link and the code", () => {
    const { text } = renderConfirmationEmail(confirmation, config);
    expect(text).toContain("Jane Roe");
    expect(text).toContain("2026-11-14");
    expect(text).toContain("20:00–22:00");
    expect(text).toContain("4");
    expect(text).toContain(`http://localhost:5173/cancel#code=${CODE}`);
    // the code also appears as plain text, apart from the link
    expect(text.replace(`#code=${CODE}`, "")).toContain(CODE);
  });

  it("contains no table name, even if one is smuggled through a cast", () => {
    const smuggled = { ...confirmation, tableName: "Window-Table-7" } as unknown as ConfirmationEmailInput;
    const { subject, text } = renderConfirmationEmail(smuggled, config);
    expect(subject + text).not.toContain("Window-Table-7");
  });

  it("replaces CR and LF in the guest name with a single space", () => {
    const { text } = renderConfirmationEmail({ ...confirmation, guestName: "Jane\r\nBcc: evil@x.test" }, config);
    expect(text).toContain("Jane Bcc: evil@x.test");
    expect(text).not.toContain("Jane\r");
    expect(text).not.toContain("Jane\n");
  });

  it("prints the stored local values unchanged near a DST change (Europe/Madrid, 2026-10-25)", () => {
    // 20:00 local on the day DST ends is 19:00 UTC; the renderer must print the stored local text.
    const reservation = {
      ...confirmation,
      date: "2026-10-25",
      startTime: "20:00",
      endTime: "22:00",
      startAt: new Date("2026-10-25T19:00:00Z"),
    };
    expect(reservation.startAt.toISOString().slice(11, 16)).not.toBe(reservation.startTime);
    const { text } = renderConfirmationEmail(reservation, config);
    expect(text).toContain("2026-10-25");
    expect(text).toContain("20:00–22:00");
    expect(text).not.toContain("19:00");
  });
});

describe("renderCancellationEmail", () => {
  it("has the fixed subject", () => {
    const { subject } = renderCancellationEmail(cancellation, config);
    expect(subject).toBe("Your reservation at La Mesa was cancelled");
    expect(subject).not.toContain("Jane");
  });

  it("says 'You cancelled' when the guest cancelled", () => {
    const { text } = renderCancellationEmail({ ...cancellation, cancelledBy: "guest" }, config);
    expect(text).toContain("You cancelled");
    expect(text).not.toContain("The restaurant cancelled");
  });

  it("says 'The restaurant cancelled' when staff cancelled", () => {
    const { text } = renderCancellationEmail({ ...cancellation, cancelledBy: "staff" }, config);
    expect(text).toContain("The restaurant cancelled");
    expect(text).not.toContain("You cancelled");
  });

  it("has name, date, times and party size, and neither the code, a fragment link nor any link", () => {
    for (const cancelledBy of ["guest", "staff"] as const) {
      const smuggled = { ...cancellation, cancelledBy, code: CODE, tableName: "Window-Table-7" } as unknown as CancellationEmailInput;
      const { text } = renderCancellationEmail(smuggled, config);
      expect(text).toContain("Jane Roe");
      expect(text).toContain("2026-11-14");
      expect(text).toContain("20:00–22:00");
      expect(text).toContain("4");
      expect(text).not.toContain(CODE);
      expect(text).not.toContain("#code=");
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toContain("Window-Table-7");
    }
  });

  it("replaces CR and LF in the guest name with a single space", () => {
    const { text } = renderCancellationEmail({ ...cancellation, guestName: "Jane\nRoe" }, config);
    expect(text).toContain("Jane Roe");
  });
});
