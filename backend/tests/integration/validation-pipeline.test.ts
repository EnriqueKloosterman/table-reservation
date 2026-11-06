import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { conflict } from "../../src/shared/errors/app-error.js";
import { defineRoute } from "../../src/shared/openapi/route.js";
import { z } from "../../src/shared/openapi/zod.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";

const ItemBody = z.strictObject({ name: z.string().trim().min(1), qty: z.number().int().min(1) });
const ItemQuery = z.strictObject({ flag: z.enum(["true", "false"]).optional() });
const ItemParams = z.strictObject({ code: z.string().regex(/^\d{3}$/) });

const app = buildTestApp({
  configureTestRoutes: (ctx) => {
    defineRoute(ctx, {
      method: "post",
      path: "/__test/items",
      summary: "Test create",
      description: "Test-only route",
      tags: ["Test"],
      auth: false,
      request: { body: { schema: ItemBody, example: { name: "apple", qty: 1 } } },
      success: { status: 201, description: "Created", schema: ItemBody },
      errors: ["VALIDATION_ERROR"],
      handler: (_req, res) => {
        res.status(201).json(res.locals.input.body);
      },
    });
    defineRoute(ctx, {
      method: "get",
      path: "/__test/items",
      summary: "Test list",
      description: "Test-only route",
      tags: ["Test"],
      auth: false,
      request: { query: ItemQuery },
      success: { status: 200, description: "OK", schema: ItemQuery },
      errors: ["VALIDATION_ERROR"],
      handler: (_req, res) => {
        res.json(res.locals.input.query);
      },
    });
    defineRoute(ctx, {
      method: "get",
      path: "/__test/items/:code",
      summary: "Test read",
      description: "Test-only route",
      tags: ["Test"],
      auth: false,
      request: { params: ItemParams, query: ItemQuery },
      success: { status: 200, description: "OK", schema: ItemParams },
      errors: ["VALIDATION_ERROR"],
      handler: (_req, res) => {
        res.json(res.locals.input.params);
      },
    });
    defineRoute(ctx, {
      method: "post",
      path: "/__test/secure",
      summary: "Test secured create",
      description: "Test-only route",
      tags: ["Test"],
      auth: true,
      request: { body: { schema: ItemBody, example: { name: "apple", qty: 1 } } },
      success: { status: 201, description: "Created", schema: ItemBody },
      errors: ["VALIDATION_ERROR"],
      handler: (_req, res) => {
        res.status(201).json(res.locals.input.body);
      },
    });
    ctx.router.get("/__test/conflict", () => {
      throw conflict("x");
    });
    ctx.router.get("/__test/duplicate-key", () => {
      throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    });
    ctx.router.get("/__test/boom", () => {
      throw new Error("secret driver message at /src/x.ts");
    });
  },
});

type Details = { field: string; reason: string }[];

const postJson = (body: string) =>
  request(app).post("/__test/items").set("Content-Type", "application/json").send(body);

describe("JSON body pipeline", () => {
  it("accepts a valid body and passes the parsed (trimmed) value", async () => {
    const res = await request(app).post("/__test/items").send({ name: "  apple ", qty: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: "apple", qty: 2 });
  });

  it("refuses malformed JSON", async () => {
    const error = expectError(await postJson('{"name":'), 400, "VALIDATION_ERROR");
    expect(error.details).toEqual([{ field: "body", reason: "Malformed JSON" }]);
  });

  it("refuses a body over 100 kB", async () => {
    const body = JSON.stringify({ name: "x".repeat(110_000), qty: 1 });
    const error = expectError(await postJson(body), 400, "VALIDATION_ERROR");
    expect(error.details).toEqual([{ field: "body", reason: "Request body exceeds 100 kB" }]);
  });

  it("refuses a text/plain body", async () => {
    const res = await request(app)
      .post("/__test/items")
      .set("Content-Type", "text/plain")
      .send('{"name":"a","qty":1}');
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect(error.details).toEqual([
      { field: "body", reason: "Content-Type must be application/json" },
    ]);
  });

  it("refuses a request without Content-Type", async () => {
    const error = expectError(await request(app).post("/__test/items"), 400, "VALIDATION_ERROR");
    expect(error.details).toEqual([
      { field: "body", reason: "Content-Type must be application/json" },
    ]);
  });

  it("accepts application/json with a charset parameter", async () => {
    const res = await request(app)
      .post("/__test/items")
      .set("Content-Type", "application/json; charset=utf-8")
      .send(JSON.stringify({ name: "a", qty: 1 }));
    expect(res.status).toBe(201);
  });

  it("refuses a top-level array with field body", async () => {
    const error = expectError(await postJson("[1,2]"), 400, "VALIDATION_ERROR");
    expect((error.details as Details).map((d) => d.field)).toEqual(["body"]);
  });

  it("refuses an unknown field", async () => {
    const res = await request(app).post("/__test/items").send({ name: "a", qty: 1, color: "red" });
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect(error.details).toEqual([{ field: "color", reason: "Unknown field" }]);
  });

  it("reports every invalid field in one response", async () => {
    const res = await request(app).post("/__test/items").send({ name: " ", qty: 0 });
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect((error.details as Details).map((d) => d.field).sort()).toEqual(["name", "qty"]);
  });

  it("ignores the query string on a route without a query schema", async () => {
    const res = await request(app).post("/__test/items?x=1").send({ name: "a", qty: 1 });
    expect(res.status).toBe(201);
  });
});

describe("query and params pipeline", () => {
  it("refuses an unknown query parameter", async () => {
    const res = await request(app).get("/__test/items?foo=1");
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect(error.details).toEqual([{ field: "query.foo", reason: "Unknown field" }]);
  });

  it("refuses an invalid query value", async () => {
    const res = await request(app).get("/__test/items?flag=yes");
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect((error.details as Details).map((d) => d.field)).toEqual(["query.flag"]);
  });

  it("refuses an invalid path parameter", async () => {
    const res = await request(app).get("/__test/items/ab");
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect((error.details as Details).map((d) => d.field)).toEqual(["params.code"]);
  });

  it("reports invalid params and query in the same response", async () => {
    const res = await request(app).get("/__test/items/ab?foo=1");
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect((error.details as Details).map((d) => d.field).sort()).toEqual([
      "params.code",
      "query.foo",
    ]);
  });

  it("passes valid params", async () => {
    const res = await request(app).get("/__test/items/123?flag=true");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: "123" });
  });
});

describe("refusal order on secured routes", () => {
  it.each([
    ["malformed JSON", "application/json", '{"name":'],
    ["oversized body", "application/json", JSON.stringify({ name: "x".repeat(110_000) })],
    ["text/plain body", "text/plain", "hello"],
    ["schema-invalid body", "application/json", JSON.stringify({ qty: 0 })],
  ])("%s without a token → 401", async (_label, type, body) => {
    const res = await request(app).post("/__test/secure").set("Content-Type", type).send(body);
    expectError(res, 401, "AUTHENTICATION_REQUIRED");
  });
});

describe("error middleware", () => {
  const consoleError = vi.spyOn(console, "error");
  beforeAll(() => {
    consoleError.mockImplementation(() => {});
  });
  afterAll(() => {
    consoleError.mockRestore();
  });

  it("maps an AppError conflict to 409", async () => {
    expectError(await request(app).get("/__test/conflict"), 409, "CONFLICT");
  });

  it("maps a stray duplicate-key error (11000) to 409", async () => {
    expectError(await request(app).get("/__test/duplicate-key"), 409, "CONFLICT");
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const res = await request(app).get("/__test/boom");
    const error = expectError(res, 500, "INTERNAL_ERROR");
    expect(error.message).toBe("An unexpected error occurred");
    expect(error.details).toBeUndefined();
    expect(res.text).not.toContain("secret");
    expect(res.text).not.toContain("/src/");
  });
});
