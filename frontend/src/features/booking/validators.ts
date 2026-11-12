import type { BookingField } from "../../api/types";
import type { ProblemKey } from "../../api/messages";
import { isCalendarDate } from "../../shared/dates";

export interface BookingDraft {
  date: string;
  partySize: string;
  time: string | null;
  name: string;
  email: string;
  phone: string;
}

export function validateDate(value: string): ProblemKey | undefined {
  return isCalendarDate(value) ? undefined : "date";
}

export function validatePartySize(value: string): ProblemKey | undefined {
  if (!/^[1-9]\d?$/.test(value)) return "partySize";
  const n = Number(value);
  return n >= 1 && n <= 50 ? undefined : "partySize";
}

export function validateName(value: string): ProblemKey | undefined {
  const v = value.trim();
  return v.length >= 1 && v.length <= 100 ? undefined : "name";
}

const EMAIL_RE = /^[^\s@,<>;"()[\]\\]+@[^\s@,<>;"()[\]\\.]+(?:\.[^\s@,<>;"()[\]\\.]+)+$/;

export function validateEmail(value: string): ProblemKey | undefined {
  const v = value.trim();
  return v.length <= 254 && EMAIL_RE.test(v) ? undefined : "email";
}

export function validatePhone(value: string): ProblemKey | undefined {
  const v = value.trim();
  if (v.length < 7 || v.length > 20) return "phone";
  if (!/^\+?[\d\s\-()]+$/.test(v)) return "phone";
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 ? undefined : "phone";
}

export function validateCode(value: string): ProblemKey | undefined {
  return value.trim().length > 0 ? undefined : "code";
}

export function validateDraft(draft: BookingDraft): Record<BookingField, ProblemKey | undefined> {
  return {
    date: validateDate(draft.date),
    time: undefined,
    partySize: validatePartySize(draft.partySize),
    name: validateName(draft.name),
    email: validateEmail(draft.email),
    phone: validatePhone(draft.phone),
  };
}
