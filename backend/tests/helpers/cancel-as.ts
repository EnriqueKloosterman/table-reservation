import type { Express } from "express";
import type request from "supertest";
import { kept } from "./keep-alive.js";

/** `POST /reservations/cancel` with `{ code }` (public, no token). */
export function cancelWithCode(app: Express, code: unknown): request.Test {
  return kept(app).post("/reservations/cancel").send({ code });
}
