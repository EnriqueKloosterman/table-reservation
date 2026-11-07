import { beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { fetchOpenApi, operationsOf, type OpenApiDocument, type Operation } from "../helpers/openapi.js";

// SC-004 / FR-025: the generated document describes exactly the mounted operations, fully.
const app = buildTestApp();
let doc: OpenApiDocument;
let operations: Operation[];

const TAGS = ["Health", "Auth", "Tables", "Schedule", "Closed dates", "Availability", "Reservations", "Documentation"];
const ERROR_REF = "#/components/schemas/ErrorResponse";

/** Error statuses per operation, from contracts/api.md. */
const EXPECTED_ERRORS: Record<string, number[]> = {
  "GET /health": [500, 503],
  "POST /auth/login": [400, 401, 500],
  "GET /auth/me": [401, 500],
  "POST /tables": [400, 401, 409, 500],
  "GET /tables": [401, 500],
  "GET /tables/{id}": [401, 404, 500],
  "PATCH /tables/{id}": [400, 401, 404, 409, 500],
  "DELETE /tables/{id}": [401, 404, 500],
  "GET /schedule": [401, 500],
  "PUT /schedule": [400, 401, 500],
  "POST /closed-dates": [400, 401, 409, 500],
  "GET /closed-dates": [400, 401, 500],
  "DELETE /closed-dates/{date}": [400, 401, 404, 500],
  "GET /openapi.json": [500],
  "GET /availability": [400, 500],
  "POST /reservations": [400, 409, 500],
};

type Layer = {
  route?: { path: unknown; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
};

/** `METHOD /path` for every route mounted in the Express 5 router stack. */
function mountedRoutes(): string[] {
  const out: string[] = [];
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        // Non-string paths are the CORS preflight handler (OPTIONS /.*/), not an operation.
        if (typeof layer.route.path !== "string") continue;
        const path = layer.route.path.replace(/:(\w+)/g, "{$1}");
        for (const method of Object.keys(layer.route.methods)) out.push(`${method.toUpperCase()} ${path}`);
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
      // Other layers are middleware (CORS, the /docs static mount, 404, errors).
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack);
  return out.sort();
}

beforeAll(async () => {
  doc = await fetchOpenApi(app);
  operations = operationsOf(doc);
});

describe("SC-004: OpenAPI coverage", () => {
  it("documents exactly the mounted routes, 16 operations", () => {
    const documented = operations.map((o) => o.key).sort();
    expect(documented).toEqual(mountedRoutes());
    expect(documented).toHaveLength(16);
    expect(documented).toEqual(Object.keys(EXPECTED_ERRORS).sort());
  });

  it("every operation is fully described", () => {
    for (const { key, op } of operations) {
      expect.soft(op.summary?.trim(), `${key} summary`).toBeTruthy();
      expect.soft(op.description?.trim(), `${key} description`).toBeTruthy();
      expect.soft(op.tags, `${key} tags`).toHaveLength(1);
      expect.soft(TAGS, `${key} tag`).toContain(op.tags?.[0]);

      const statuses = Object.keys(op.responses);
      const success = statuses.filter((s) => s.startsWith("2"));
      expect.soft(success, `${key} success`).toHaveLength(1);
      for (const s of success) {
        const response = op.responses[s]!;
        expect.soft(response.description?.trim(), `${key} ${s} description`).toBeTruthy();
        if (s !== "204") {
          expect.soft(response.content?.["application/json"]?.schema, `${key} ${s} schema`).toBeDefined();
        }
      }

      const errors = statuses.filter((s) => !s.startsWith("2")).map(Number).sort((a, b) => a - b);
      expect.soft(errors, `${key} error statuses`).toEqual(EXPECTED_ERRORS[key]);
      if ((op.security ?? []).length > 0) expect.soft(errors, `${key} 401`).toContain(401);

      for (const s of statuses.filter((x) => !x.startsWith("2"))) {
        const response = op.responses[s]!;
        expect.soft(response.content?.["application/json"]?.schema?.$ref, `${key} ${s} ref`).toBe(ERROR_REF);
        expect.soft(response.description, `${key} ${s} names codes`).toMatch(/`[A-Z_]+`/);
      }

      if (op.requestBody) {
        const media = op.requestBody.content?.["application/json"];
        expect.soft(media?.example ?? media?.examples, `${key} request example`).toBeDefined();
      }
    }
  });

  it("documents the server and how to use the API", () => {
    expect(doc.servers).toEqual([{ url: "/" }]);
    const description = doc.info.description ?? "";
    expect(description.trim()).not.toBe("");
    expect(description).toContain("/auth/login");
    expect(description).toContain("Authorize");
    expect(description).toContain("error.code");
  });
});
