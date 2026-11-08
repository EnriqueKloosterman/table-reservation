import type { Config } from "../../config/env.js";
import { systemClock, type Clock } from "../../shared/clock.js";
import type { EmailMessage, EmailMeta, EmailSender } from "./email-sender.js";
import { renderCancellationEmail, renderConfirmationEmail } from "./email-templates.js";

type NotifierConfig = Pick<Config, "EMAIL_TIMEOUT_MS" | "RESTAURANT_NAME" | "CANCEL_LINK_BASE_URL">;

/** The reservation fields an email needs. No table: it never appears in an email. */
export type NotifiableReservation = {
  id: string;
  guestName: string;
  guestEmail: string;
  date: string;
  startTime: string;
  endTime: string;
  partySize: number;
};

export type Notifier = {
  /** Starts sending the confirmation and returns at once. Never throws, never rejects. */
  notifyConfirmation(reservation: NotifiableReservation, code: string): void;
  /** Starts sending the cancellation notice and returns at once. Never throws, never rejects. */
  notifyCancellation(reservation: NotifiableReservation & { cancelledBy: "guest" | "staff" }): void;
  /** Resolves when no attempt is pending. Tests use it instead of sleeping. */
  idle(): Promise<void>;
};

const MAX_REASON_LENGTH = 64;

/** `error.code ?? error.name` as a short string. `error.message` is never read: it can hold addresses. */
function failureReason(error: unknown): string {
  if (typeof error !== "object" || error === null) return "Unknown";
  const { code, name } = error as { code?: unknown; name?: unknown };
  const reason = code ?? name;
  if (typeof reason !== "string" || reason.length === 0) return "Unknown";
  return reason.slice(0, MAX_REASON_LENGTH);
}

function timeoutError(): Error {
  const error = new Error("Email send timed out");
  error.name = "EmailTimeout";
  return error;
}

/**
 * Sends emails in the background (research R4): callers never await, so a slow or failing
 * mail server cannot delay or change a response. A failure becomes one log line with the kind,
 * the reservation id and a short reason, never the code, the address, the name or the message.
 */
export function createNotifier(
  sender: EmailSender,
  config: NotifierConfig,
  clock: Clock = systemClock,
): Notifier {
  const pending = new Set<Promise<void>>();

  async function attempt(build: () => EmailMessage, meta: EmailMeta): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const message = build();
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError()), config.EMAIL_TIMEOUT_MS);
        timer.unref();
      });
      await Promise.race([sender.send(message, meta), timeout]);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "email_failed",
          kind: meta.kind,
          reservationId: meta.reservationId,
          reason: failureReason(error),
          at: clock.now().toISOString(),
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function start(build: () => EmailMessage, meta: EmailMeta): void {
    const run = attempt(build, meta);
    pending.add(run);
    void run.then(() => pending.delete(run));
  }

  return {
    notifyConfirmation(reservation, code) {
      start(
        () => ({ to: reservation.guestEmail, ...renderConfirmationEmail({ ...reservation, code }, config) }),
        { kind: "confirmation", reservationId: reservation.id },
      );
    },
    notifyCancellation(reservation) {
      start(() => ({ to: reservation.guestEmail, ...renderCancellationEmail(reservation, config) }), {
        kind: "cancellation",
        reservationId: reservation.id,
      });
    },
    async idle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
