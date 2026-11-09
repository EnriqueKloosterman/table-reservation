import type { Express } from "express";
import request from "supertest";
import { DEFAULT_STAFF } from "./seed-staff.js";

/** Signs in through `POST /auth/login` and returns the bearer token. */
export async function loginAs(
  app: Express,
  creds: { email: string; password: string } = DEFAULT_STAFF,
): Promise<string> {
  const res = await request(app)
    .post("/auth/login")
    .send({ email: creds.email, password: creds.password });
  if (res.status !== 200) {
    throw new Error(`loginAs failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return (res.body as { token: string }).token;
}
