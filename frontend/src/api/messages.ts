import type { AvailabilityReason, ConflictReason, ErrorCode } from "./types";

export interface Message {
  title: string;
  body: string;
  next?: string;
}

export const GENERIC_MESSAGE: Message = {
  title: "Something went wrong.",
  body: "We couldn't complete that.",
  next: "Please try again.",
};

export const AVAILABILITY_MESSAGES: Record<AvailabilityReason, Message> = {
  closed_date: {
    title: "Closed on that date.",
    body: "The restaurant is closed on that date (holiday or special closure).",
    next: "Choose another date.",
  },
  closed_day: {
    title: "Closed on that day.",
    body: "The restaurant is normally closed on that day of the week.",
    next: "Choose another date.",
  },
  too_soon: {
    title: "Too soon to book.",
    body: "That date is too soon to book online.",
    next: "Choose a later date or contact the restaurant.",
  },
  too_far_ahead: {
    title: "Too far ahead.",
    body: "That date is too far ahead to book yet.",
    next: "Choose an earlier date.",
  },
  party_too_large: {
    title: "Party too large.",
    body: "We can't seat a party of that size online.",
    next: "Try a smaller party or contact the restaurant.",
  },
  no_table_free: {
    title: "Fully booked.",
    body: "There are no tables left for that day and party size.",
    next: "Try another date or party size.",
  },
  outside_service_hours: {
    title: "Outside booking hours.",
    body: "The restaurant doesn't take bookings at that time.",
    next: "Choose another date or time.",
  },
};

export const CONFLICT_MESSAGES: Record<ConflictReason, Message> = {
  duplicate_reservation: {
    title: "You already have a reservation.",
    body: "This email already has a reservation around that time. Nothing was booked.",
    next: "Choose another time, or contact the restaurant. If you didn't see a confirmation, check your inbox first.",
  },
  table_has_upcoming_reservations: GENERIC_MESSAGE,
};

const SERVER_ERROR_MESSAGE: Message = {
  title: "We couldn't complete that right now.",
  body: "The service had a problem.",
  next: "Please try again in a moment.",
};

export const ERROR_CODE_MESSAGES: Record<ErrorCode, Message> = {
  VALIDATION_ERROR: {
    title: "Please check the details.",
    body: "Some of the details are not valid.",
    next: "Fix the fields and try again.",
  },
  NOT_FOUND: {
    title: "We couldn't find that reservation.",
    body: "There is no reservation for that code.",
    next: "Check the link in your email or type the code again.",
  },
  ALREADY_CANCELLED: {
    title: "This reservation was already cancelled.",
    body: "It is no longer active.",
    next: "Nothing more is needed.",
  },
  CANNOT_CANCEL: {
    title: "This reservation can no longer be cancelled online.",
    body: "It has started or ended.",
    next: "Contact the restaurant if you need help.",
  },
  CONFLICT: GENERIC_MESSAGE,
  NO_AVAILABILITY: GENERIC_MESSAGE,
  SERVICE_UNAVAILABLE: SERVER_ERROR_MESSAGE,
  INTERNAL_ERROR: SERVER_ERROR_MESSAGE,
  AUTHENTICATION_REQUIRED: GENERIC_MESSAGE,
  INVALID_CREDENTIALS: GENERIC_MESSAGE,
};

export const CLIENT_MESSAGES = {
  timesServerError: {
    title: "We couldn't load the available times.",
    body: "The service had a problem.",
    next: "Try again.",
  },
  createServerError: {
    title: "Your reservation couldn't be completed.",
    body: "Nothing was confirmed on our side.",
    next: "Check your email before trying again.",
  },
  timesUnreachable: {
    title: "We can't reach the server right now.",
    body: "The available times could not be loaded.",
    next: "Check your connection and try again.",
  },
  createUnreachable: {
    title: "We don't know whether your reservation was made. A confirmation email may already be on its way.",
    body: "The connection was lost while booking.",
    next: "Check your email before trying again.",
  },
  cancelTemporary: {
    title: "We couldn't complete the cancellation just now.",
    body: "Your reservation has not been changed by this attempt.",
    next: "Try again; pressing it twice is safe.",
  },
  config: {
    title: "This service isn't available right now.",
    body: "We can't show the booking page at the moment.",
    next: "Please try again later.",
  },
  cancelReady: {
    title: "You are about to cancel your reservation.",
    body: "Nothing is cancelled until you press the button.",
  },
  cancelMissingCode: {
    title: "We couldn't find a cancellation code in this link.",
    body: "Type or paste the code from your email below.",
  },
  idlePrompt: {
    title: "Choose a date and a party size to see the available times.",
    body: "",
  },
  confirmation: {
    title: "Your table is booked",
    body: "We've emailed you how to cancel.",
    next: "Start a new booking.",
  },
  cancelled: {
    title: "Your reservation is cancelled",
    body: "We have cancelled it and freed the table.",
    next: "Make a new booking.",
  },
  noTableFreeLeadIn: {
    title: "That time was just taken.",
    body: "Here are the times that are still available.",
  },
} satisfies Record<string, Message>;

export type ProblemKey = "date" | "partySize" | "time" | "name" | "email" | "phone" | "code" | "form";

export const FIELD_PROBLEMS: Record<ProblemKey, string> = {
  date: "Enter a valid date.",
  partySize: "Enter a whole number from 1 to 50.",
  time: "Choose one of the available times.",
  name: "Enter your name (up to 100 characters).",
  email: "Enter a valid email address (up to 254 characters).",
  phone:
    "Enter a phone number with at least 7 digits and at most 20 characters (spaces, hyphens, parentheses and a leading + are allowed).",
  code: "Enter the cancellation code from your email.",
  form: "Please check the details and try again.",
};

function lookup<K extends string>(
  catalog: Record<K, Message>,
  value: string,
): Message {
  return Object.hasOwn(catalog, value) ? catalog[value as K] : GENERIC_MESSAGE;
}

export function messageForAvailability(value: string): Message {
  return lookup(AVAILABILITY_MESSAGES, value);
}

export function messageForConflict(value: string): Message {
  return lookup(CONFLICT_MESSAGES, value);
}

export function messageForCode(value: string): Message {
  return lookup(ERROR_CODE_MESSAGES, value);
}
