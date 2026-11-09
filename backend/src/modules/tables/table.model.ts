import { Schema, model } from "mongoose";
import { registerModel } from "../../db/connection.js";

const tableSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
    /** `name.trim().toLowerCase()`, set by the service on every create and rename. */
    nameKey: { type: String, required: true },
    capacity: {
      type: Number,
      required: true,
      min: 1,
      max: 50,
      validate: { validator: Number.isInteger, message: "capacity must be an integer" },
    },
    removed: { type: Boolean, default: false },
    removedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Names are unique among active tables only; removed tables free their name.
tableSchema.index(
  { nameKey: 1 },
  { unique: true, partialFilterExpression: { removed: false }, name: "nameKey_active_unique" },
);

export const Table = registerModel(model("Table", tableSchema));
