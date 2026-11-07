import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { loginAs } from "../helpers/login-as.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

// SC-003: every error category uses the standard body shape (checked by expectError).
useTestDatabase();

const app = buildTestApp({
  configureTestRoutes: (ctx) => {
    ctx.router.get("/__boom", () => {
      throw new Error("secret driver message at /src/x.ts");
    });
  },
});
let token = "";

beforeEach(async () => {
  await seedStaff();
  token = await loginAs(app);
});

const authed = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);
const postTables = () => authed(request(app).post("/tables"));

describe("SC-003: error shape", () => {
  const consoleError = vi.spyOn(console, "error");
  beforeAll(() => {
    consoleError.mockImplementation(() => {});
  });
  afterAll(() => {
    consoleError.mockRestore();
  });

  it("validation error carries field details", async () => {
    const error = expectError(await postTables().send({ capacity: 0 }), 400, "VALIDATION_ERROR");
    const details = error.details as { field: string; reason: string }[];
    expect(details.length).toBeGreaterThan(0);
    for (const d of details) expect(d.field).toEqual(expect.any(String));
  });

  it("malformed JSON", async () => {
    expectError(
      await postTables().set("Content-Type", "application/json").send('{"name":'),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("non-JSON body", async () => {
    expectError(await postTables().set("Content-Type", "text/plain").send("T1"), 400, "VALIDATION_ERROR");
  });

  it("oversized body", async () => {
    const body = JSON.stringify({ name: "x".repeat(110_000), capacity: 4 });
    expectError(await postTables().set("Content-Type", "application/json").send(body), 400, "VALIDATION_ERROR");
  });

  it("unknown field", async () => {
    expectError(await postTables().send({ name: "T1", capacity: 4, color: "red" }), 400, "VALIDATION_ERROR");
  });

  it("missing proof", async () => {
    expectError(await request(app).get("/tables"), 401, "AUTHENTICATION_REQUIRED");
  });

  it("invalid credentials", async () => {
    const res = await request(app).post("/auth/login").send({ email: "ana@resto.com", password: "nope" });
    expectError(res, 401, "INVALID_CREDENTIALS");
  });

  it("unknown operation", async () => {
    expectError(await request(app).get("/nope"), 404, "NOT_FOUND");
  });

  it("unknown table id", async () => {
    expectError(await authed(request(app).get("/tables/0123456789abcdef01234567")), 404, "NOT_FOUND");
  });

  it("conflict", async () => {
    expect((await postTables().send({ name: "T1", capacity: 4 })).status).toBe(201);
    expectError(await postTables().send({ name: "T1", capacity: 4 }), 409, "CONFLICT");
  });

  it("service unavailable", async () => {
    const res = await request(buildTestApp({ isDatabaseUp: () => false })).get("/health");
    expectError(res, 503, "SERVICE_UNAVAILABLE");
  });

  it("unexpected failure is generic and leaks nothing", async () => {
    const res = await request(app).get("/__boom");
    const error = expectError(res, 500, "INTERNAL_ERROR");
    expect(error.message).toBe("An unexpected error occurred");
    expect(error.details).toBeUndefined();
    expect(res.text).not.toContain("secret");
    expect(res.text).not.toContain("Error");
    expect(res.text).not.toContain("/src/");
  });
});
