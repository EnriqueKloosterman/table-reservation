import { Schema, model } from "mongoose";
import { registerModel } from "../../db/connection.js";
import { DATE_REGEX } from "./closed-dates.domain.js";

const closedDateSchema = new Schema(
  {
    // Restaurant-local calendar date, stored as text and never converted to UTC.
    date: { type: String, required: true, match: DATE_REGEX, unique: true },
    reason: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

export const ClosedDate = registerModel(model("ClosedDate", closedDateSchema));
