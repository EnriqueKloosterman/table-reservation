import { Schema, model } from "mongoose";
import { registerModel } from "../../db/connection.js";
import { DATE_REGEX } from "../closed-dates/closed-dates.domain.js";

const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Strips the secret code hash from any serialization. */
const withoutHash = (_doc: unknown, ret: Record<string, unknown>) => {
  delete ret["secretCodeHash"];
  return ret;
};

const reservationSchema = new Schema(
  {
    status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
    /** UTC instant of the cancellation, from the injected clock; `null` while confirmed. */
    cancelledAt: { type: Date, default: null },
    /** Who cancelled; `null` while confirmed. */
    cancelledBy: { type: String, enum: ["guest", "staff"], default: null },
    /** Kept when the table is later soft-deleted (FR-018). */
    tableId: { type: Schema.Types.ObjectId, ref: "Table", required: true },
    // Restaurant-local text snapshots; `startAt`/`endAt` are the UTC instants.
    date: { type: String, required: true, match: DATE_REGEX },
    startTime: { type: String, required: true, match: TIME_FORMAT },
    endTime: { type: String, required: true, match: TIME_FORMAT },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    partySize: {
      type: Number,
      required: true,
      min: 1,
      max: 50,
      validate: { validator: Number.isInteger, message: "partySize must be an integer" },
    },
    guestName: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    guestEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    guestPhone: { type: String, required: true, trim: true, minlength: 7, maxlength: 20 },
    /** SHA-256 hex of the secret code; never selected and never serialized. */
    secretCodeHash: { type: String, required: true, select: false },
    /** Set by the service from the injected clock, so tests can pin it. */
    createdAt: { type: Date, required: true },
  },
  { timestamps: false, toJSON: { transform: withoutHash }, toObject: { transform: withoutHash } },
);

// There is no overlap index here: the overlap invariant lives in `TableDay`.
reservationSchema.index({ tableId: 1, endAt: 1 });
reservationSchema.index({ endAt: 1 });
reservationSchema.index({ date: 1 });
// The guest looks a reservation up by the hash of the code, so it must be unique (research R6).
reservationSchema.index({ secretCodeHash: 1 }, { unique: true });

export const Reservation = registerModel(model("Reservation", reservationSchema));
