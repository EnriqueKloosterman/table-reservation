import request from "supertest";
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
  "DELETE /tables/{id}": [401, 404, 409, 500],
  "GET /schedule": [401, 500],
  "PUT /schedule": [400, 401, 500],
  "POST /closed-dates": [400, 401, 409, 500],
  "GET /closed-dates": [400, 401, 500],
  "DELETE /closed-dates/{date}": [400, 401, 404, 500],
  "GET /openapi.json": [500],
  "GET /availability": [400, 500],
  "GET /availability/times": [400, 500],
  "POST /reservations": [400, 409, 500],
  "POST /reservations/cancel": [400, 404, 409, 500],
  "POST /reservations/{id}/cancel": [401, 404, 409, 500],
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
  it("documents exactly the mounted routes, 19 operations", () => {
    const documented = operations.map((o) => o.key).sort();
    expect(documented).toEqual(mountedRoutes());
    expect(documented).toHaveLength(19);
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

// ---------------------------------------------------------------------------------------------
// Feature 002 (US5): the three public operations, the new error code and the changed responses.
// ---------------------------------------------------------------------------------------------

type Schema = {
  $ref?: string;
  type?: string;
  enum?: string[];
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
};

const NEW_PUBLIC = ["GET /availability", "GET /availability/times", "POST /reservations"];
const AVAILABILITY_REASONS = [
  "too_soon",
  "too_far_ahead",
  "closed_date",
  "closed_day",
  "outside_service_hours",
  "party_too_large",
  "no_table_free",
];

const schemas = () => (doc.components.schemas ?? {}) as Record<string, Schema>;
const byKey = (key: string) => operations.find((o) => o.key === key)!;
const refName = (ref: string | undefined) => ref?.split("/").pop() ?? "";

function containsKey(node: unknown, key: string): boolean {
  if (Array.isArray(node)) return node.some((n) => containsKey(n, key));
  if (node && typeof node === "object") {
    return Object.entries(node).some(([k, v]) => k === key || containsKey(v, key));
  }
  return false;
}

describe("US5 / FR-024: documentation of the new public operations", () => {
  it.each(NEW_PUBLIC)("%s is described and marked as public", (key) => {
    const { op } = byKey(key);
    expect(op.summary?.trim()).toBeTruthy();
    expect(op.description).toMatch(/^Public — no sign-in required\./);
    expect(op.security ?? []).toHaveLength(0);
  });

  it.each(["GET /availability", "GET /availability/times"])(
    "%s has an example for every query parameter",
    (key) => {
      const params = (byKey(key).op as unknown as { parameters?: unknown[] }).parameters ?? [];
      expect(params.length).toBeGreaterThan(0);
      for (const p of params) {
        expect(containsKey(p, "example") || containsKey(p, "examples"), JSON.stringify(p)).toBe(true);
      }
    },
  );

  it("POST /reservations has a body example that matches the contract", () => {
    const media = byKey("POST /reservations").op.requestBody?.content?.["application/json"];
    expect(media?.example).toEqual({
      date: "2026-11-14",
      time: "20:30",
      partySize: 3,
      name: "Ana García",
      email: "ana@mail.com",
      phone: "+34 600 123 456",
    });
  });

  it("each new operation has its success schema and every error response of the contract", () => {
    const expectedStatuses: Record<string, [string, number[]]> = {
      "GET /availability": ["200", [400, 500]],
      "GET /availability/times": ["200", [400, 500]],
      "POST /reservations": ["201", [400, 409, 500]],
    };
    for (const [key, [success, errors]] of Object.entries(expectedStatuses)) {
      const { responses } = byKey(key).op;
      expect(Object.keys(responses).sort(), key).toEqual([success, ...errors.map(String)].sort());
      expect(responses[success]!.content?.["application/json"]?.schema?.$ref, key).toBeTruthy();
      for (const status of errors) {
        expect(
          responses[String(status)]!.content?.["application/json"]?.schema?.$ref,
          `${key} ${status}`,
        ).toBe(ERROR_REF);
      }
    }
  });

  it("the reason categories are described on every availability operation", () => {
    for (const key of NEW_PUBLIC) {
      const text = byKey(key).op.description ?? "";
      for (const reason of AVAILABILITY_REASONS) {
        expect(text, `${key} mentions ${reason}`).toContain(`\`${reason}\``);
      }
    }
  });

  it("GET /availability and POST /reservations list the reasons in precedence order", () => {
    for (const key of ["GET /availability", "POST /reservations"]) {
      const text = byKey(key).op.description ?? "";
      let last = -1;
      for (const reason of AVAILABILITY_REASONS) {
        const at = text.indexOf(`\`${reason}\``);
        expect(at, `${key} lists ${reason} in order`).toBeGreaterThan(last);
        last = at;
      }
    }
  });
});

describe("US5 / FR-025: NO_AVAILABILITY and the conflict reasons are described", () => {
  it("ErrorResponse.code includes NO_AVAILABILITY", () => {
    const error = schemas()["ErrorResponse"]!.properties!["error"]!;
    expect(error.properties!["code"]!.enum).toContain("NO_AVAILABILITY");
  });

  it("the AvailabilityReason component lists the seven reasons in precedence order", () => {
    const reason = schemas()["AvailabilityReason"]!;
    expect(reason.enum).toEqual(AVAILABILITY_REASONS);
    expect(reason.description).toBeTruthy();
  });

  it("the ConflictReason component lists the two conflict reasons", () => {
    const reason = schemas()["ConflictReason"]!;
    expect(reason.enum).toEqual(["duplicate_reservation", "table_has_upcoming_reservations"]);
    expect(reason.description).toBeTruthy();
  });

  it("ErrorResponse.details is a oneOf with the field errors, the database variant and both reasons", () => {
    const details = schemas()["ErrorResponse"]!.properties!["error"]!.properties!["details"] as unknown as {
      oneOf: unknown[];
    };
    expect(details.oneOf).toHaveLength(4);
    const text = JSON.stringify(details.oneOf);
    expect(text).toContain("#/components/schemas/AvailabilityReason");
    expect(text).toContain("#/components/schemas/ConflictReason");
    expect(text).toContain("database");
  });

  it("POST /reservations documents both 409 codes and their reasons", () => {
    const text = byKey("POST /reservations").op.responses["409"]!.description ?? "";
    expect(text).toContain("`NO_AVAILABILITY`");
    expect(text).toContain("`CONFLICT`");
    for (const reason of AVAILABILITY_REASONS) expect(text).toContain(`\`${reason}\``);
    expect(text).toContain("duplicate_reservation");
    const description = byKey("POST /reservations").op.description ?? "";
    expect(description).toContain("duplicate_reservation");
    expect(description).toContain("no_table_free");
  });

  it("DELETE /tables/{id} documents the 409 and drops the 'not enforced' note", () => {
    const { op } = byKey("DELETE /tables/{id}");
    expect(Object.keys(op.responses)).toContain("409");
    expect(op.responses["409"]!.description).toContain("`CONFLICT`");
    expect(op.responses["409"]!.description).toContain("table_has_upcoming_reservations");
    expect(op.description).toContain("table_has_upcoming_reservations");
    expect(op.description).not.toMatch(/not enforced/i);
  });
});

describe("US5 / FR-024: the three changed responses include affectedReservations", () => {
  const cases: [string, string, string][] = [
    ["POST /closed-dates", "201", "CreatedClosedDate"],
    ["PUT /schedule", "200", "ReplacedSchedule"],
    ["PATCH /tables/{id}", "200", "UpdatedTable"],
  ];

  it.each(cases)("%s %s → %s", (key, status, component) => {
    const ref = byKey(key).op.responses[status]!.content?.["application/json"]?.schema?.$ref;
    expect(refName(ref)).toBe(component);
    const schema = schemas()[component]!;
    const affected = schema.properties!["affectedReservations"]!;
    expect(affected.type).toBe("array");
    expect(affected.description).toMatch(/Always present/);
    expect(schema.required).toContain("affectedReservations");
    expect(refName(affected.items?.$ref)).toBe("AffectedReservation");
  });

  it("an affected reservation shows id, date, start and end time, party size, guest name, table name and status", () => {
    const item = schemas()["AffectedReservation"]!;
    expect(Object.keys(item.properties!).sort()).toEqual([
      "date",
      "endTime",
      "guestName",
      "id",
      "partySize",
      "startTime",
      "status",
      "tableName",
    ]);
  });

  it("the read operations keep their 001 shapes", () => {
    const ref = (key: string) => byKey(key).op.responses["200"]!.content?.["application/json"]?.schema?.$ref;
    expect(refName(ref("GET /schedule"))).toBe("WeeklySchedule");
    expect(refName(ref("GET /tables/{id}"))).toBe("Table");
  });
});

describe("US5 / FR-013: the secret code appears only in the creation response", () => {
  it("only the ReservationConfirmation schema has a secretCode property", () => {
    const holders = Object.entries(schemas())
      .filter(([, s]) => s.properties && "secretCode" in s.properties)
      .map(([name]) => name);
    expect(holders).toEqual(["ReservationConfirmation"]);
  });

  it("that schema is referenced only by the 201 of POST /reservations", () => {
    const users: string[] = [];
    for (const { key, op } of operations) {
      for (const [status, response] of Object.entries(op.responses)) {
        const ref = response.content?.["application/json"]?.schema?.$ref;
        if (refName(ref) === "ReservationConfirmation") users.push(`${key} ${status}`);
      }
      expect(JSON.stringify(op.requestBody ?? {}).includes("ReservationConfirmation"), `${key} request`).toBe(false);
    }
    expect(users).toEqual(["POST /reservations 201"]);
    const others = Object.entries(schemas())
      .filter(([name]) => name !== "ReservationConfirmation")
      .filter(([, s]) => JSON.stringify(s).includes("ReservationConfirmation"));
    expect(others).toEqual([]);
  });

  it("the property says it is shown only once", () => {
    const secret = schemas()["ReservationConfirmation"]!.properties!["secretCode"]!;
    expect(secret.description).toMatch(/only here/i);
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 003 (US2): the public guest cancellation.
// ---------------------------------------------------------------------------------------------

describe("feature 003 / FR-023: POST /reservations/cancel is documented as public", () => {
  const key = "POST /reservations/cancel";

  it("is public: no security requirement and a description that says so", () => {
    const { op } = byKey(key);
    expect(op.summary?.trim()).toBeTruthy();
    expect(op.description).toMatch(/^Public — no sign-in required\./);
    expect(op.security ?? []).toHaveLength(0);
  });

  it("states that the code is accepted only in the body, never in the URL", () => {
    const text = byKey(key).op.description ?? "";
    expect(text).toMatch(/body/i);
    expect(text).toMatch(/never in the URL|not in the URL|never.*URL/i);
  });

  it("has a request example with the code field", () => {
    const media = byKey(key).op.requestBody?.content?.["application/json"];
    expect(media?.example).toBeDefined();
    expect(Object.keys(media?.example as object)).toEqual(["code"]);
  });

  it("documents 200 and the error statuses 400, 404, 409 and 500 with their codes", () => {
    const { responses } = byKey(key).op;
    expect(Object.keys(responses).sort()).toEqual(["200", "400", "404", "409", "500"]);
    expect(refName(responses["200"]!.content?.["application/json"]?.schema?.$ref)).toBe("CancellationResult");
    for (const status of ["400", "404", "409", "500"]) {
      expect(responses[status]!.content?.["application/json"]?.schema?.$ref, status).toBe(ERROR_REF);
    }
    expect(responses["400"]!.description).toContain("`VALIDATION_ERROR`");
    expect(responses["404"]!.description).toContain("`NOT_FOUND`");
    expect(responses["409"]!.description).toContain("`ALREADY_CANCELLED`");
    expect(responses["409"]!.description).toContain("`CANNOT_CANCEL`");
    expect(responses["500"]!.description).toContain("`INTERNAL_ERROR`");
  });

  it("the CancellationResult component has exactly the documented fields and no code, hash or contact data", () => {
    const result = schemas()["CancellationResult"]!;
    expect(Object.keys(result.properties!).sort()).toEqual([
      "cancelledAt",
      "date",
      "endTime",
      "id",
      "partySize",
      "startTime",
      "status",
    ]);
    expect(result.properties!["status"]!.enum ?? [(result.properties!["status"] as { const?: string }).const]).toContain(
      "cancelled",
    );
    const text = JSON.stringify(result);
    for (const forbidden of ["secretCode", "secretCodeHash", "guest", "table", "email", "phone"]) {
      expect(text, forbidden).not.toContain(`"${forbidden}"`);
    }
  });

  it("the new error codes are listed in ErrorResponse", () => {
    const codes = schemas()["ErrorResponse"]!.properties!["error"]!.properties!["code"]!.enum;
    expect(codes).toContain("ALREADY_CANCELLED");
    expect(codes).toContain("CANNOT_CANCEL");
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 003 (US3): the staff cancellation.
// ---------------------------------------------------------------------------------------------

describe("feature 003 / US3: POST /reservations/{id}/cancel is documented as a staff operation", () => {
  const key = "POST /reservations/{id}/cancel";

  it("requires the bearer token and does not claim to be public", () => {
    const { op } = byKey(key);
    expect(op.summary?.trim()).toBeTruthy();
    expect(op.description).not.toMatch(/^Public/);
    expect(op.description).toMatch(/staff|sign-in/i);
    expect((op.security ?? []).length).toBeGreaterThan(0);
  });

  it("has an id path parameter and no required request body", () => {
    const { op } = byKey(key);
    const params = (op.parameters ?? []) as { name: string; in: string; required?: boolean }[];
    expect(params.some((p) => p.name === "id" && p.in === "path")).toBe(true);
    expect(op.requestBody?.required ?? false).toBe(false);
  });

  it("documents 200, 401, 404, 409 and 500 with their codes", () => {
    const { responses } = byKey(key).op;
    expect(Object.keys(responses).sort()).toEqual(["200", "401", "404", "409", "500"]);
    expect(refName(responses["200"]!.content?.["application/json"]?.schema?.$ref)).toBe("CancellationResult");
    for (const status of ["401", "404", "409", "500"]) {
      expect(responses[status]!.content?.["application/json"]?.schema?.$ref, status).toBe(ERROR_REF);
    }
    expect(responses["401"]!.description).toContain("`AUTHENTICATION_REQUIRED`");
    expect(responses["404"]!.description).toContain("`NOT_FOUND`");
    expect(responses["409"]!.description).toContain("`ALREADY_CANCELLED`");
    expect(responses["409"]!.description).toContain("`CANNOT_CANCEL`");
    expect(responses["500"]!.description).toContain("`INTERNAL_ERROR`");
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 003 (US5): final pins for the whole contract.
// ---------------------------------------------------------------------------------------------

describe("feature 003 / US5: the contract documents both cancellation operations", () => {
  it("has exactly 19 operations, 7 of them public with the public description prefix", () => {
    expect(operations).toHaveLength(19);
    const publicOps = operations.filter((o) => (o.op.security ?? []).length === 0);
    expect(publicOps.map((o) => o.key).sort()).toEqual([
      "GET /availability",
      "GET /availability/times",
      "GET /health",
      "GET /openapi.json",
      "POST /auth/login",
      "POST /reservations",
      "POST /reservations/cancel",
    ]);
    for (const { key, op } of operations.filter((o) => o.key.startsWith("POST /reservations"))) {
      const isPublic = (op.security ?? []).length === 0;
      if (isPublic) expect(op.description, key).toMatch(/^Public — no sign-in required\./);
    }
  });

  it("every response of both cancellation operations has an example (on the response or on its schema component)", () => {
    for (const key of ["POST /reservations/cancel", "POST /reservations/{id}/cancel"]) {
      const { responses } = byKey(key).op;
      for (const [status, response] of Object.entries(responses)) {
        const media: { example?: unknown; examples?: unknown; schema?: { $ref?: string } } | undefined =
          response.content?.["application/json"];
        const component = schemas()[refName(media?.schema?.$ref)] as { example?: unknown } | undefined;
        expect(media?.example ?? media?.examples ?? component?.example, `${key} ${status} example`).toBeDefined();
      }
    }
  });

  it("the ReservationStatus schema lists exactly confirmed and cancelled", () => {
    const status = schemas()["ReservationStatus"];
    expect(status, "ReservationStatus component").toBeDefined();
    expect([...(status!.enum ?? [])].sort()).toEqual(["cancelled", "confirmed"]);
  });

  it("POST /reservations states the confirmation email and that a send failure never changes the response", () => {
    const text = byKey("POST /reservations").op.description ?? "";
    expect(text).toMatch(/confirmation email/i);
    expect(text).toMatch(/never change/i);
    expect(text).not.toMatch(/No email is sent/i);
  });

  it("the ErrorResponse code enum includes the two cancellation codes", () => {
    const codes = schemas()["ErrorResponse"]!.properties!["error"]!.properties!["code"]!.enum;
    expect(codes).toEqual(expect.arrayContaining(["ALREADY_CANCELLED", "CANNOT_CANCEL"]));
  });

  it("Swagger UI at /docs responds 200", async () => {
    const res = await request(app).get("/docs/");
    expect(res.status).toBe(200);
  });
});
