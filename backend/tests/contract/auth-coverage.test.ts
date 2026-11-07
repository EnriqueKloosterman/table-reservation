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
  it("the public operations are exactly health, login, the OpenAPI document and the availability check", () => {
    const publicOps = operationsOf(doc)
      .filter((o) => (o.op.security ?? []).length === 0)
      .map((o) => o.key)
      .sort();
    expect(publicOps).toEqual([
      "GET /availability",
      "GET /health",
      "GET /openapi.json",
      "POST /auth/login",
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
