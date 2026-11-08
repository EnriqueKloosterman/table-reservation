import type { Config } from "../../config/env.js";

type EmailConfig = Pick<Config, "RESTAURANT_NAME" | "CANCEL_LINK_BASE_URL">;

type BookingDetails = {
  guestName: string;
  /** Restaurant-local `YYYY-MM-DD`, as stored. */
  date: string;
  /** Restaurant-local `HH:mm`, as stored. */
  startTime: string;
  endTime: string;
  partySize: number;
};

// Deliberately no table field: the table name can never reach an email.
export type ConfirmationEmailInput = BookingDetails & { code: string };
export type CancellationEmailInput = BookingDetails & { cancelledBy: "guest" | "staff" };

export type RenderedEmail = { subject: string; text: string };

/** The guest name goes only in the body, with every line break replaced by one space. */
const singleLine = (value: string): string => value.replace(/[\r\n]+/g, " ");

function bookingLines(input: BookingDetails): string[] {
  return [
    `Date: ${input.date}`,
    `Time: ${input.startTime}–${input.endTime}`,
    `Party size: ${input.partySize}`,
  ];
}

export function renderConfirmationEmail(input: ConfirmationEmailInput, config: EmailConfig): RenderedEmail {
  const link = `${config.CANCEL_LINK_BASE_URL}#code=${input.code}`;
  const text = [
    `Hello ${singleLine(input.guestName)},`,
    "",
    `Your reservation at ${config.RESTAURANT_NAME} is confirmed.`,
    "",
    ...bookingLines(input),
    "",
    "If your plans change, you can cancel your reservation with this link:",
    link,
    "",
    "You can also cancel with this code:",
    input.code,
    "",
    "Keep this email: the code is needed to cancel and cannot be recovered.",
  ].join("\n");
  return { subject: `Your reservation at ${config.RESTAURANT_NAME} is confirmed`, text };
}

export function renderCancellationEmail(input: CancellationEmailInput, config: EmailConfig): RenderedEmail {
  const who = input.cancelledBy === "guest" ? "You cancelled" : "The restaurant cancelled";
  const text = [
    `Hello ${singleLine(input.guestName)},`,
    "",
    `${who} your reservation at ${config.RESTAURANT_NAME}:`,
    "",
    ...bookingLines(input),
  ].join("\n");
  return { subject: `Your reservation at ${config.RESTAURANT_NAME} was cancelled`, text };
}
