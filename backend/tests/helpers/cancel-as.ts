import type { Express } from "express";
import type request from "supertest";
import { kept } from "./keep-alive.js";

/** `POST /reservations/cancel` with `{ code }` (public, no token). */
export function cancelWithCode(app: Express, code: unknown): request.Test {
  return kept(app).post("/reservations/cancel").send({ code });
}

/** `POST /reservations/{id}/cancel` as staff (omit the token to test refusals). */
export function cancelAsStaff(app: Express, id: string, token?: string): request.Test {
  const req = kept(app).post(`/reservations/${id}/cancel`);
  return token === undefined ? req : req.set("Authorization", `Bearer ${token}`);
}
