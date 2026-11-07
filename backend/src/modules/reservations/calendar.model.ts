import { Schema, model } from "mongoose";
import { registerModel } from "../../db/connection.js";

/** A claimed time range of one reservation (data-model.md). */
const intervalSchema = new Schema(
  {
    reservationId: { type: Schema.Types.ObjectId, required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * Per-table, per-date calendar. The overlap invariant (FR-011) is guaranteed by the atomic
 * conditional `$push` in `claimInterval`, not by a schema validator. Documents are never deleted.
 */
const tableDaySchema = new Schema({
  tableId: { type: Schema.Types.ObjectId, ref: "Table", required: true },
  date: { type: String, required: true },
  intervals: { type: [intervalSchema], default: [] },
});
tableDaySchema.index({ tableId: 1, date: 1 }, { unique: true });

/** Per-email, per-date calendar enforcing FR-026 the same way. */
const guestDaySchema = new Schema({
  email: { type: String, required: true },
  date: { type: String, required: true },
  intervals: { type: [intervalSchema], default: [] },
});
guestDaySchema.index({ email: 1, date: 1 }, { unique: true });

export const TableDay = registerModel(model("TableDay", tableDaySchema));
export const GuestDay = registerModel(model("GuestDay", guestDaySchema));
