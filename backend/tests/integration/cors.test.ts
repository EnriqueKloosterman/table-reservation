import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

describe("CORS", () => {
  const app = buildTestApp();

  it("answers a preflight from an allowed origin without a token", async () => {
    const res = await request(app)
      .options("/tables")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Authorization, Content-Type");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-methods"]).toBe("GET,POST,PUT,PATCH,DELETE");
    const allowedHeaders = String(res.headers["access-control-allow-headers"]).toLowerCase();
    expect(allowedHeaders).toContain("authorization");
    expect(allowedHeaders).toContain("content-type");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("sends no Access-Control-Allow-Origin to a disallowed origin", async () => {
    const res = await request(app)
      .options("/tables")
      .set("Origin", "http://evil.test")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
