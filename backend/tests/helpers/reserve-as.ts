import type { Express } from "express";
import type request from "supertest";
import { kept } from "./keep-alive.js";

export const DEFAULT_RESERVATION = {
  date: "2026-11-14",
  time: "20:00",
  partySize: 2,
  name: "Ana Guest",
  email: "ana@mail.com",
  phone: "+34 600 111 222",
};

/** POST /reservations with sensible defaults; override any field (public, no token). */
export function reserveAs(app: Express, overrides: Record<string, unknown> = {}): request.Test {
  return kept(app)
    .post("/reservations")
    .send({ ...DEFAULT_RESERVATION, ...overrides });
}
