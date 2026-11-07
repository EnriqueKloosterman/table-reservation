import { z } from "../../shared/openapi/zod.js";
import { CalendarDateSchema } from "../closed-dates/closed-dates.schemas.js";
import { TimeSchema } from "../schedule/schedule.schemas.js";

const PHONE_MESSAGE =
  "Must be 7-20 characters: digits, spaces, '-', '(' and ')' with an optional leading '+', " +
  "and at least 7 digits";

/** One rule, one message, so a bad phone is reported once. */
export function isValidPhone(phone: string): boolean {
  return (
    phone.length >= 7 &&
    phone.length <= 20 &&
    /^\+?[0-9 ()-]+$/.test(phone) &&
    phone.replace(/\D/g, "").length >= 7
  );
}

const name = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .openapi({ description: "Guest name, 1-100 characters after trimming.", example: "Ana García" });

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email())
  .openapi({
    description: "One email address (no display name, no list), at most 254 characters; stored lowercased.",
    example: "ana@mail.com",
  });

const phone = z
  .string()
  .trim()
  .refine(isValidPhone, PHONE_MESSAGE)
  .openapi({
    description: `${PHONE_MESSAGE}.`,
    example: "+34 600 123 456",
    minLength: 7,
    maxLength: 20,
  });

export const CreateReservationBodySchema = z
  .strictObject({
    date: CalendarDateSchema.openapi({ example: "2026-11-14" }),
    time: TimeSchema.openapi({ description: "Start time, restaurant-local HH:mm.", example: "20:30" }),
    partySize: z.number().int().min(1).max(50).openapi({ description: "Number of guests, integer 1-50.", example: 3 }),
    name,
    email,
    phone,
  })
  .openapi("CreateReservation");

export const CREATE_RESERVATION_EXAMPLE = {
  date: "2026-11-14",
  time: "20:30",
  partySize: 3,
  name: "Ana García",
  email: "ana@mail.com",
  phone: "+34 600 123 456",
};

export const ReservationConfirmationSchema = z
  .object({
    id: z.string().openapi({ example: "6741a0ffee0123456789abcd" }),
    status: z.literal("confirmed"),
    date: z.string().openapi({ example: "2026-11-14" }),
    startTime: z.string().openapi({ example: "20:30" }),
    endTime: z.string().openapi({ example: "22:30" }),
    partySize: z.number().int().openapi({ example: 3 }),
    guest: z.object({
      name: z.string().openapi({ example: "Ana García" }),
      email: z.string().openapi({ example: "ana@mail.com" }),
      phone: z.string().openapi({ example: "+34 600 123 456" }),
    }),
    table: z.object({ name: z.string().openapi({ example: "T4" }) }),
    createdAt: z.string().openapi({ description: "UTC instant.", example: "2026-11-07T10:15:00.000Z" }),
    secretCode: z.string().openapi({
      description:
        "Secret code (256 random bits, base64url). Returned only here: it is never stored in " +
        "plain text, logged or returned again.",
      example: "Yq3k0v8p1Zr7mWbN2xTfH5cJdL9sAeUoGiPyQ4tKXhE",
    }),
  })
  .openapi("ReservationConfirmation");

/** A reservation reported by a staff change that contradicts it (US4). */
export const AffectedReservationSchema = z
  .object({
    id: z.string().openapi({ example: "6741a0ffee0123456789abcd" }),
    date: z.string().openapi({ example: "2026-12-24" }),
    startTime: z.string().openapi({ example: "20:00" }),
    endTime: z.string().openapi({ example: "22:00" }),
    partySize: z.number().int().openapi({ example: 6 }),
    guestName: z.string().openapi({ example: "Ana García" }),
    tableName: z.string().openapi({ example: "T5" }),
  })
  .openapi("AffectedReservation");

export type CreateReservationInput = z.output<typeof CreateReservationBodySchema>;
export type ReservationConfirmation = z.output<typeof ReservationConfirmationSchema>;
export type AffectedReservation = z.output<typeof AffectedReservationSchema>;
