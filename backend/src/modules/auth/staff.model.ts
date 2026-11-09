import { Schema, model } from "mongoose";
import { registerModel } from "../../db/connection.js";

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const staffMemberSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: EMAIL_FORMAT,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

export const StaffMember = registerModel(model("StaffMember", staffMemberSchema));
