import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { fetchOpenApi, operationsOf, type OpenApiDocument, type Operation } from "../helpers/openapi.js";

// SC-002: every secured operation refuses requests without proof, whatever the body.
const app = buildTestApp();
let doc: OpenApiDocument;
let secured: Operation[];

const DUMMY_PARAMS: Record<string, string> = {
  id: "0123456789abcdef01234567",
  date: "2026-12-25",
};

function concretePath(path: string): string {
  return path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = DUMMY_PARAMS[name];
    if (!value) throw new Error(`No dummy value for path parameter {${name}}`);
    return value;
  });
}

function call(op: Operation) {
  const method = op.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  return request(app)[method](concretePath(op.path));
}

const hasBody = (op: Operation) => ["POST", "PUT", "PATCH"].includes(op.method);

beforeAll(async () => {
  doc = await fetchOpenApi(app);
  secured = operationsOf(doc).filter((o) => (o.op.security ?? []).length > 0);
});

describe("SC-002: authentication coverage", () => {
  it("the public operations are exactly health, login, the OpenAPI document and the public availability and reservation operations", () => {
    const publicOps = operationsOf(doc)
      .filter((o) => (o.op.security ?? []).length === 0)
      .map((o) => o.key)
      .sort();
    expect(publicOps).toEqual([
      "GET /availability",
      "GET /availability/times",
      "GET /health",
      "GET /openapi.json",
      "POST /auth/login",
      "POST /reservations",
    ]);
  });

  it("there are secured operations to check", () => {
    expect(secured.length).toBeGreaterThan(0);
  });

  it("every secured operation refuses a request without a token", async () => {
    for (const op of secured) {
      const res = await call(op);
      expect.soft(res.status, op.key).toBe(401);
      expectError(res, 401, "AUTHENTICATION_REQUIRED");
    }
  });

  const badBodies: [string, string, string][] = [
    ["schema-invalid JSON body", "application/json", JSON.stringify({ unexpected: true, capacity: 0 })],
    ["malformed JSON", "application/json", '{"a":'],
    ["body over 100 kB", "application/json", JSON.stringify({ pad: "x".repeat(110_000) })],
    ["text/plain body", "text/plain", "hello"],
  ];

  it.each(badBodies)("every secured POST/PUT/PATCH refuses a %s without a token", async (_l, type, body) => {
    const withBody = secured.filter(hasBody);
    expect(withBody.length).toBeGreaterThan(0);
    for (const op of withBody) {
      const res = await call(op).set("Content-Type", type).send(body);
      expect.soft(res.status, op.key).toBe(401);
      expectError(res, 401, "AUTHENTICATION_REQUIRED");
    }
  });

  it("GET /docs/ is public", async () => {
    expect((await request(app).get("/docs/")).status).toBe(200);
  });

  it("declares the bearerAuth security scheme", () => {
    expect(doc.components.securitySchemes?.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    });
  });
});

describe("feature 002: the new operations are public", () => {
  const FINAL_PUBLIC = [
    "GET /availability",
    "GET /availability/times",
    "GET /health",
    "GET /openapi.json",
    "POST /auth/login",
    "POST /reservations",
  ];

  it("the public set is exactly the six operations", () => {
    const publicOps = operationsOf(doc)
      .filter((o) => (o.op.security ?? []).length === 0)
      .map((o) => o.key)
      .sort();
    expect(publicOps).toEqual(FINAL_PUBLIC);
    expect(publicOps).toHaveLength(6);
  });

  it("no staff operation became public", () => {
    const staff = operationsOf(doc).filter((o) => !FINAL_PUBLIC.includes(o.key));
    expect(staff.length).toBe(11);
    for (const op of staff) expect((op.op.security ?? []).length, op.key).toBeGreaterThan(0);
  });

  it("the new operations never answer 401 without a token (validation errors answer 400)", async () => {
    const responses = [
      await request(app).get("/availability"),
      await request(app).get("/availability/times"),
      await request(app).post("/reservations").send({}),
      await request(app).get("/availability").query({ date: "x", time: "y", partySize: "z" }),
      await request(app).post("/reservations").set("Content-Type", "text/plain").send("hello"),
    ];
    for (const res of responses) {
      expect(res.status).toBe(400);
      expectError(res, 400, "VALIDATION_ERROR");
    }
  });

  it("a bogus bearer token on a new operation is ignored, not rejected", async () => {
    const res = await request(app).get("/availability").set("Authorization", "Bearer not-a-token");
    expect(res.status).toBe(400); // still validation, never 401
  });

  it("every staff operation still answers 401 without a token", async () => {
    const staff = operationsOf(doc).filter((o) => !FINAL_PUBLIC.includes(o.key));
    for (const op of staff) {
      const res = await call(op);
      expect.soft(res.status, op.key).toBe(401);
    }
  });
});
