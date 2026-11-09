import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

describe("GET /health", () => {
  it("returns 200 when the database is up", async () => {
    const res = await request(buildTestApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "up" });
  });

  it("returns 503 SERVICE_UNAVAILABLE when the database is down", async () => {
    const res = await request(buildTestApp({ isDatabaseUp: () => false })).get("/health");
    const error = expectError(res, 503, "SERVICE_UNAVAILABLE");
    expect(error.details).toEqual({ database: "down" });
  });
});

describe("unknown routes", () => {
  const app = buildTestApp();

  it("GET /nope → 404 NOT_FOUND", async () => {
    const error = expectError(await request(app).get("/nope"), 404, "NOT_FOUND");
    expect(error.message).toBe("Route not found");
  });

  it("unsupported method on a known path → 404 NOT_FOUND", async () => {
    expectError(await request(app).delete("/health"), 404, "NOT_FOUND");
  });

  it("malformed JSON on an unknown route → 404, not 400", async () => {
    const res = await request(app)
      .post("/nope")
      .set("Content-Type", "application/json")
      .send('{"a":');
    expectError(res, 404, "NOT_FOUND");
  });

  it("oversized body on an unknown route → 404", async () => {
    const res = await request(app)
      .post("/nope")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ a: "x".repeat(110_000) }));
    expectError(res, 404, "NOT_FOUND");
  });

  it("text/plain body on an unknown route → 404", async () => {
    const res = await request(app).post("/nope").set("Content-Type", "text/plain").send("hello");
    expectError(res, 404, "NOT_FOUND");
  });
});

describe("documentation", () => {
  const app = buildTestApp();

  it("GET /openapi.json → OpenAPI 3.1 document", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect((res.body as { openapi: string }).openapi).toMatch(/^3\.1/);
  });

  it("GET /docs/ → Swagger UI HTML", async () => {
    const res = await request(app).get("/docs/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });
});
