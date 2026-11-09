import nodemailer from "nodemailer";
import type { Config } from "../../config/env.js";
import { systemClock, type Clock } from "../../shared/clock.js";

export type EmailMessage = { to: string; subject: string; text: string };

/** What the log lines may say about an email: its kind and the reservation, nothing else. */
export type EmailMeta = { kind: "confirmation" | "cancellation"; reservationId: string };

export interface EmailSender {
  send(message: EmailMessage, meta?: EmailMeta): Promise<void>;
}

type SmtpSettings = { url: string; from: string; timeoutMs: number };

/** Sends through the SMTP server named by `SMTP_URL`. The connection is opened lazily on the first send. */
export class NodemailerSender implements EmailSender {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;

  constructor({ url, from, timeoutMs }: SmtpSettings) {
    // Object form: `createTransport(url, defaults)` cannot carry the connection timeouts.
    // There is deliberately no `verify()` call, so an unreachable server never blocks startup.
    this.transport = nodemailer.createTransport({
      url,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });
    this.from = from;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

/** Used when no `SMTP_URL` is configured: records that an email was skipped and sends nothing. */
export class NoopEmailSender implements EmailSender {
  private readonly clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.clock = clock;
  }

  send(_message: EmailMessage, meta?: EmailMeta): Promise<void> {
    console.log(
      JSON.stringify({
        event: "email_skipped",
        kind: meta?.kind,
        reservationId: meta?.reservationId,
        at: this.clock.now().toISOString(),
      }),
    );
    return Promise.resolve();
  }
}

/** The SMTP sender when `SMTP_URL` is set, otherwise the no-op sender. */
export function createEmailSender(
  config: Pick<Config, "EMAIL_TIMEOUT_MS"> & Partial<Pick<Config, "SMTP_URL" | "EMAIL_FROM">>,
  clock: Clock = systemClock,
): EmailSender {
  if (config.SMTP_URL === undefined || config.EMAIL_FROM === undefined) return new NoopEmailSender(clock);
  return new NodemailerSender({
    url: config.SMTP_URL,
    from: config.EMAIL_FROM,
    timeoutMs: config.EMAIL_TIMEOUT_MS,
  });
}
