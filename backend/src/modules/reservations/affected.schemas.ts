import { z } from "../../shared/openapi/zod.js";

// Kept apart from `reservations.schemas.ts` so the 001 modules can import it without a cycle
// (that file imports the closed-date and schedule schemas).

/** A reservation reported by a staff change that contradicts it (FR-022). */
export const AffectedReservationSchema = z
  .object({
    id: z.string().openapi({ example: "6741a0ffee0123456789abcd" }),
    date: z.string().openapi({ example: "2026-12-24" }),
    startTime: z.string().openapi({ example: "20:00" }),
    endTime: z.string().openapi({ example: "22:00" }),
    partySize: z.number().int().openapi({ example: 6 }),
    guestName: z.string().openapi({ example: "Ana García" }),
    tableName: z.string().openapi({ example: "T5" }),
    status: z.literal("confirmed").openapi({
      description: "Always `confirmed`: cancelled reservations are never listed (see `ReservationStatus`).",
    }),
  })
  .openapi("AffectedReservation");

export type AffectedReservation = z.output<typeof AffectedReservationSchema>;
