import type { EmailMessage, EmailMeta, EmailSender } from "../../src/modules/notifications/email-sender.js";

export type FakeEmailMode = "ok" | "fail" | "slow" | "never";

export type SentEmail = { message: EmailMessage; meta: EmailMeta | undefined };

/** The address and message the `fail` mode puts in its error, to prove they are never logged. */
export const FAKE_FAILURE_ADDRESS = "jane@example.test";
export const FAKE_FAILURE_MESSAGE = `Recipient address rejected: <${FAKE_FAILURE_ADDRESS}>`;

/**
 * Test double for `EmailSender` (research R11). `ok` records the email, `fail` rejects with an
 * error whose `code` is `EENVELOPE` and whose message embeds an address, `slow` records after
 * a delay, and `never` never settles.
 */
export class FakeEmailSender implements EmailSender {
  readonly sent: SentEmail[] = [];
  private mode: FakeEmailMode;
  private delayMs: number;

  constructor(mode: FakeEmailMode = "ok", delayMs = 2000) {
    this.mode = mode;
    this.delayMs = delayMs;
  }

  setMode(mode: FakeEmailMode, delayMs?: number): void {
    this.mode = mode;
    if (delayMs !== undefined) this.delayMs = delayMs;
  }

  send(message: EmailMessage, meta?: EmailMeta): Promise<void> {
    switch (this.mode) {
      case "ok":
        this.sent.push({ message, meta });
        return Promise.resolve();
      case "fail":
        return Promise.reject(Object.assign(new Error(FAKE_FAILURE_MESSAGE), { code: "EENVELOPE" }));
      case "slow":
        return new Promise((resolve) => {
          setTimeout(() => {
            this.sent.push({ message, meta });
            resolve();
          }, this.delayMs);
        });
      case "never":
        return new Promise<void>(() => {});
    }
  }

  /** The secret code in the body of the last recorded confirmation (the text after `#code=`). */
  lastCode(): string {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const entry = this.sent[i];
      if (entry?.meta?.kind !== "confirmation") continue;
      const match = /#code=([A-Za-z0-9_-]+)/.exec(entry.message.text);
      if (match?.[1]) return match[1];
    }
    throw new Error("No confirmation email with a code was recorded");
  }
}
