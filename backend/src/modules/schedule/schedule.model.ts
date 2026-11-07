import { Schema, model } from "mongoose";
import { registerModel } from "../../db/connection.js";
import { DAYS } from "./schedule.domain.js";

const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

const servicePeriodSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
    // Restaurant-local wall-clock times, stored as text and never converted to UTC.
    start: { type: String, required: true, match: TIME_FORMAT },
    end: { type: String, required: true, match: TIME_FORMAT },
  },
  { _id: false },
);

const dayScheduleSchema = new Schema(
  {
    day: { type: String, required: true, enum: DAYS },
    periods: { type: [servicePeriodSchema], default: [] },
  },
  { _id: false },
);

/** Single document with `_id: "weekly"`. */
const weeklyScheduleSchema = new Schema(
  {
    _id: { type: String, required: true },
    days: { type: [dayScheduleSchema], default: [] },
  },
  { timestamps: true },
);

export const WEEKLY_SCHEDULE_ID = "weekly";

export const WeeklySchedule = registerModel(model("WeeklySchedule", weeklyScheduleSchema));
