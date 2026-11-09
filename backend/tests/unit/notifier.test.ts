import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  createEmailSender,
  NodemailerSender,
  NoopEmailSender,
  type EmailSender,
} from "../../src/modules/notifications/email-sender.js";
import { createNotifier, type Notifier } from "../../src/modules/notifications/notifier.js";
import { FAKE_FAILURE_ADDRESS, FAKE_FAILURE_MESSAGE, FakeEmailSender } from "../helpers/fake-email-sender.js";

const config = {
  EMAIL_TIMEOUT_MS: 200,
  RESTAURANT_NAME: "La Mesa",
  CANCEL_LINK_BASE_URL: "http://localhost:5173/cancel",
};
const reservation = {
  id: "6730f1c2a1b2c3d4e5f60718",
  guestName: "Jane Roe",
  guestEmail: FAKE_FAILURE_ADDRESS,
  date: "2026-11-14",
  startTime: "20:00",
  endTime: "22:00",
  partySize: 2,
};
const CODE = "k3J9xQ7mV0aB4tYw2uHnR8dLzE5cFgS1pXoI6vMqTaU";

let errorSpy: MockInstance<typeof console.error>;
let logSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const lines = (spy: MockInstance<typeof console.error> | MockInstance<typeof console.log>): string[] =>
  spy.mock.calls.map((c) => String(c[0]));
const parse = (line: string | undefined): Record<string, unknown> => JSON.parse(line ?? "null") as Record<string, unknown>;
const failing = (props: Record<string, unknown>): Error => Object.assign(new Error("failed"), props);

describe("createNotifier: never blocks the caller", () => {
  it("returns undefined synchronously, even with a sender that never settles", () => {
    const notifier = createNotifier(new FakeEmailSender("never"), config);
    expect(notifier.notifyConfirmation(reservation, CODE)).toBeUndefined();
    expect(notifier.notifyCancellation({ ...reservation, cancelledBy: "guest" })).toBeUndefined();
  });

  it("hands one confirmation and one cancellation to the sender with kind and reservationId", async () => {
    const sender = new FakeEmailSender("ok");
    const notifier = createNotifier(sender, config);
    notifier.notifyConfirmation(reservation, CODE);
    notifier.notifyCancellation({ ...reservation, cancelledBy: "staff" });
    await notifier.idle();
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[0]?.meta).toEqual({ kind: "confirmation", reservationId: reservation.id });
    expect(sender.sent[0]?.message.to).toBe(reservation.guestEmail);
    expect(sender.sent[0]?.message.text).toContain(`#code=${CODE}`);
    expect(sender.sent[1]?.meta).toEqual({ kind: "cancellation", reservationId: reservation.id });
    expect(sender.sent[1]?.message.text).toContain("The restaurant cancelled");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("createNotifier: failures are logged without leaking", () => {
  it("a failing sender yields exactly one email_failed line with only safe fields", async () => {
    const notifier = createNotifier(new FakeEmailSender("fail"), config);
    notifier.notifyConfirmation(reservation, CODE);
    await notifier.idle();

    const out = lines(errorSpy);
    expect(out).toHaveLength(1);
    const line = out[0] as string;
    const parsed = parse(line);
    expect(Object.keys(parsed).sort()).toEqual(["at", "event", "kind", "reason", "reservationId"]);
    expect(parsed).toMatchObject({
      event: "email_failed",
      kind: "confirmation",
      reservationId: reservation.id,
      reason: "EENVELOPE",
    });
    expect(new Date(parsed["at"] as string).toISOString()).toBe(parsed["at"]);

    for (const secret of [CODE, FAKE_FAILURE_ADDRESS, "jane", "example.test", "Jane", "Roe", FAKE_FAILURE_MESSAGE]) {
      expect(line).not.toContain(secret);
    }
    expect(line).not.toContain("\n");
  });

  it("abandons a sender that never settles after EMAIL_TIMEOUT_MS, leaving no timer", async () => {
    vi.useFakeTimers();
    const notifier = createNotifier(new FakeEmailSender("never"), config);
    notifier.notifyCancellation({ ...reservation, cancelledBy: "guest" });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(config.EMAIL_TIMEOUT_MS);
    await notifier.idle();
    expect(vi.getTimerCount()).toBe(0);
    const out = lines(errorSpy);
    expect(out).toHaveLength(1);
    expect(parse(out[0])).toMatchObject({
      event: "email_failed",
      kind: "cancellation",
      reason: "EmailTimeout",
    });
  });

  it("clears the timer when the send succeeds", async () => {
    vi.useFakeTimers();
    const notifier = createNotifier(new FakeEmailSender("ok"), config);
    notifier.notifyConfirmation(reservation, CODE);
    await notifier.idle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("catches a sender that throws synchronously", async () => {
    const sender: EmailSender = {
      send() {
        throw new Error(`boom ${FAKE_FAILURE_ADDRESS}`);
      },
    };
    const notifier = createNotifier(sender, config);
    expect(notifier.notifyConfirmation(reservation, CODE)).toBeUndefined();
    await notifier.idle();
    const out = lines(errorSpy);
    expect(out).toHaveLength(1);
    expect(parse(out[0])).toMatchObject({ event: "email_failed", reason: "Error" });
    expect(out[0]).not.toContain(FAKE_FAILURE_ADDRESS);
  });

  it("falls back to 'Unknown' for a non-string reason", async () => {
    const sender: EmailSender = { send: () => Promise.reject(failing({ code: 42 })) };
    const notifier = createNotifier(sender, config);
    notifier.notifyConfirmation(reservation, CODE);
    await notifier.idle();
    expect(parse(lines(errorSpy)[0]).reason).toBe("Unknown");
  });

  it("falls back to 'Unknown' when the rejection is not an object", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const sender: EmailSender = { send: () => Promise.reject("just a string") };
    const notifier = createNotifier(sender, config);
    notifier.notifyConfirmation(reservation, CODE);
    await notifier.idle();
    expect(parse(lines(errorSpy)[0]).reason).toBe("Unknown");
  });

  it("truncates a long reason", async () => {
    const sender: EmailSender = { send: () => Promise.reject(failing({ code: "X".repeat(500) })) };
    const notifier = createNotifier(sender, config);
    notifier.notifyConfirmation(reservation, CODE);
    await notifier.idle();
    const reason = parse(lines(errorSpy)[0]).reason as string;
    expect(reason.startsWith("XXX")).toBe(true);
    expect(reason.length).toBeLessThanOrEqual(64);
  });
});

describe("idle()", () => {
  it("resolves only after every pending attempt settled, including one registered while waiting", async () => {
    let release: (() => void) | undefined;
    const holder: { notifier?: Notifier } = {};
    let calls = 0;
    const sender: EmailSender = {
      send() {
        calls += 1;
        if (calls === 1) {
          // Registers another attempt while idle() is already waiting on this one.
          holder.notifier?.notifyCancellation({ ...reservation, cancelledBy: "guest" });
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    const notifier = createNotifier(sender, config);
    holder.notifier = notifier;
    notifier.notifyConfirmation(reservation, CODE);

    let done = false;
    const idle = notifier.idle().then(() => {
      done = true;
    });
    await new Promise((r) => setImmediate(r));
    expect(calls).toBe(2);
    expect(done).toBe(false); // the second attempt is still pending

    release?.();
    await idle;
    expect(done).toBe(true);
  });

  it("resolves immediately when nothing is pending", async () => {
    await expect(createNotifier(new FakeEmailSender("ok"), config).idle()).resolves.toBeUndefined();
  });
});

describe("NoopEmailSender", () => {
  it("logs one email_skipped line with only kind and reservationId, and sends nothing", async () => {
    const sender = new NoopEmailSender();
    await sender.send(
      { to: reservation.guestEmail, subject: "s", text: `body ${CODE}` },
      { kind: "confirmation", reservationId: reservation.id },
    );
    const out = lines(logSpy);
    expect(out).toHaveLength(1);
    const parsed = parse(out[0]);
    expect(Object.keys(parsed).sort()).toEqual(["at", "event", "kind", "reservationId"]);
    expect(parsed).toMatchObject({ event: "email_skipped", kind: "confirmation", reservationId: reservation.id });
    expect(out[0]).not.toContain(CODE);
    expect(out[0]).not.toContain("jane");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("through the notifier logs skipped, never failed", async () => {
    const notifier = createNotifier(new NoopEmailSender(), config);
    notifier.notifyCancellation({ ...reservation, cancelledBy: "staff" });
    await notifier.idle();
    expect(lines(logSpy)).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("createEmailSender", () => {
  it("returns the Noop sender when SMTP_URL is absent", () => {
    expect(createEmailSender({ EMAIL_TIMEOUT_MS: 10000 })).toBeInstanceOf(NoopEmailSender);
  });

  it("returns a Nodemailer sender when SMTP_URL is set, without opening a connection", () => {
    // Port 1 is closed: construction must not try to reach it (no verify() call).
    const sender = createEmailSender({
      SMTP_URL: "smtp://127.0.0.1:1",
      EMAIL_FROM: "noreply@resto.test",
      EMAIL_TIMEOUT_MS: 10000,
    });
    expect(sender).toBeInstanceOf(NodemailerSender);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
