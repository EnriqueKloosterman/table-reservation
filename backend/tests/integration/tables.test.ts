import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { loginAs } from "../helpers/login-as.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

type TableBody = { id: string; name: string; capacity: number };
type Details = { field: string; reason: string }[];

const UNKNOWN_ID = "0123456789abcdef01234567";
const app = buildTestApp();
let token = "";

beforeEach(async () => {
  await seedStaff();
  token = await loginAs(app);
});

const auth = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);
const post = (body: unknown) => auth(request(app).post("/tables")).send(body as object);
const patch = (id: string, body: unknown) =>
  auth(request(app).patch(`/tables/${id}`)).send(body as object);
const get = (id: string) => auth(request(app).get(`/tables/${id}`));
const del = (id: string) => auth(request(app).delete(`/tables/${id}`));
const list = () => auth(request(app).get("/tables"));

async function create(name: string, capacity = 4): Promise<TableBody> {
  const res = await post({ name, capacity });
  expect(res.status).toBe(201);
  return res.body as TableBody;
}

function fieldsOf(details: unknown): string[] {
  return (details as Details).map((d) => d.field);
}

describe("POST /tables", () => {
  it("US2 #1: creates a table with a Location header", async () => {
    const res = await post({ name: "T1", capacity: 4 });
    expect(res.status).toBe(201);
    const body = res.body as TableBody;
    expect(body).toEqual({ id: expect.stringMatching(/^[0-9a-f]{24}$/) as string, name: "T1", capacity: 4 });
    expect(res.headers.location).toBe(`/tables/${body.id}`);
  });

  it("US2 #1: stores the name trimmed", async () => {
    expect((await create("  Patio 3 ")).name).toBe("Patio 3");
  });

  it("US2 #3: refuses a name matching an active table, ignoring case and spaces", async () => {
    await create("T1");
    expectError(await post({ name: " t1 ", capacity: 2 }), 409, "CONFLICT");
  });

  it("creates exactly one table under concurrent duplicate requests", async () => {
    const results = await Promise.all([
      post({ name: "Dup", capacity: 2 }),
      post({ name: "Dup", capacity: 2 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expectError(results.find((r) => r.status === 409)!, 409, "CONFLICT");
    expect(await Table.countDocuments({ removed: false })).toBe(1);
  });

  describe("US2 #5: validation", () => {
    it.each([
      ["missing name", { capacity: 4 }, ["name"]],
      ["empty name", { name: "", capacity: 4 }, ["name"]],
      ["whitespace name", { name: "   ", capacity: 4 }, ["name"]],
      ["51-char name after trim", { name: ` ${"n".repeat(51)} `, capacity: 4 }, ["name"]],
      ["null name", { name: null, capacity: 4 }, ["name"]],
      ["capacity 0", { name: "T1", capacity: 0 }, ["capacity"]],
      ["capacity -1", { name: "T1", capacity: -1 }, ["capacity"]],
      ["capacity 4.5", { name: "T1", capacity: 4.5 }, ["capacity"]],
      ["capacity 51", { name: "T1", capacity: 51 }, ["capacity"]],
      ["capacity as string", { name: "T1", capacity: "4" }, ["capacity"]],
      ["null capacity", { name: "T1", capacity: null }, ["capacity"]],
      ["missing capacity", { name: "T1" }, ["capacity"]],
      ["both invalid", { name: "", capacity: 0 }, ["capacity", "name"]],
    ])("%s → 400", async (_label, body, fields) => {
      const error = expectError(await post(body), 400, "VALIDATION_ERROR");
      expect(fieldsOf(error.details).sort()).toEqual(fields);
    });

    it("accepts a 50-char name", async () => {
      expect((await create("n".repeat(50))).name).toHaveLength(50);
    });

    it("refuses an unknown field", async () => {
      const error = expectError(await post({ name: "T1", capacity: 4, color: "red" }), 400, "VALIDATION_ERROR");
      expect(error.details).toEqual([{ field: "color", reason: "Unknown field" }]);
    });

    it("accepts capacity 4.0 as 4", async () => {
      const res = await auth(request(app).post("/tables"))
        .set("Content-Type", "application/json")
        .send('{"name":"T1","capacity":4.0}');
      expect(res.status).toBe(201);
      expect((res.body as TableBody).capacity).toBe(4);
    });
  });

  describe("body edge cases", () => {
    const raw = (type: string, body: string) =>
      auth(request(app).post("/tables")).set("Content-Type", type).send(body);

    it("malformed JSON", async () => {
      const error = expectError(await raw("application/json", '{"name":'), 400, "VALIDATION_ERROR");
      expect(error.details).toEqual([{ field: "body", reason: "Malformed JSON" }]);
    });

    it("text/plain", async () => {
      const error = expectError(await raw("text/plain", "T1"), 400, "VALIDATION_ERROR");
      expect(fieldsOf(error.details)).toEqual(["body"]);
    });

    it("body over 100 kB", async () => {
      const body = JSON.stringify({ name: "x".repeat(110_000), capacity: 4 });
      const error = expectError(await raw("application/json", body), 400, "VALIDATION_ERROR");
      expect(error.details).toEqual([{ field: "body", reason: "Request body exceeds 100 kB" }]);
    });

    it("top-level array", async () => {
      const error = expectError(await raw("application/json", "[]"), 400, "VALIDATION_ERROR");
      expect(fieldsOf(error.details)).toEqual(["body"]);
    });
  });

  describe("check order", () => {
    it("no token and an invalid body → 401", async () => {
      const res = await request(app).post("/tables").send({ capacity: 0 });
      expectError(res, 401, "AUTHENTICATION_REQUIRED");
    });

    it("duplicate name with an invalid capacity → 400, not 409", async () => {
      await create("T1");
      const error = expectError(await post({ name: "T1", capacity: 0 }), 400, "VALIDATION_ERROR");
      expect(fieldsOf(error.details)).toEqual(["capacity"]);
    });
  });
});

describe("GET /tables", () => {
  it("US2 #2: lists active tables in natural, case-insensitive order", async () => {
    await create("T10");
    await create("t2");
    await create("T1");
    const res = await list();
    expect(res.status).toBe(200);
    const body = res.body as TableBody[];
    expect(body.map((t) => t.name)).toEqual(["T1", "t2", "T10"]);
    for (const item of body) expect(Object.keys(item).sort()).toEqual(["capacity", "id", "name"]);
  });

  it("returns an empty list when there are no tables", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("PATCH /tables/:id", () => {
  it("US2 #4: updates the capacity", async () => {
    const table = await create("T1");
    const res = await patch(table.id, { capacity: 6 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...table, capacity: 6 });
    expect(((await get(table.id)).body as TableBody).capacity).toBe(6);
  });

  it("US2 #3: refuses renaming to another active table's name", async () => {
    await create("T1");
    const other = await create("T2");
    expectError(await patch(other.id, { name: "T1 " }), 409, "CONFLICT");
  });

  it("allows resubmitting the table's own name with different case and spaces", async () => {
    const table = await create("T1");
    const res = await patch(table.id, { name: " t1 " });
    expect(res.status).toBe(200);
    expect((res.body as TableBody).name).toBe("t1");
  });

  it("answers 200 for a request that changes nothing", async () => {
    const table = await create("T1", 4);
    const res = await patch(table.id, { name: "T1", capacity: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(table);
  });

  it("refuses an empty body with field body", async () => {
    const table = await create("T1");
    const error = expectError(await patch(table.id, {}), 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details)).toEqual(["body"]);
  });

  it.each([
    ["null name", { name: null }, ["name"]],
    ["null capacity", { capacity: null }, ["capacity"]],
    ["capacity 0", { capacity: 0 }, ["capacity"]],
    // Only an unknown field: it is reported, and so is the missing "at least one field".
    ["only an unknown field", { color: "red" }, ["body", "color"]],
    ["an unknown field next to a valid one", { capacity: 6, color: "red" }, ["color"]],
  ])("refuses %s", async (_label, body, fields) => {
    const table = await create("T1");
    const error = expectError(await patch(table.id, body), 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details).sort()).toEqual(fields);
  });

  it("SC-005: a refused update leaves the table unchanged", async () => {
    await create("T1");
    const table = await create("T2", 3);
    expectError(await patch(table.id, { name: "T1", capacity: 5 }), 409, "CONFLICT");
    expectError(await patch(table.id, { name: "T9", capacity: 0 }), 400, "VALIDATION_ERROR");
    expect((await get(table.id)).body).toEqual(table);
  });

  describe("check order", () => {
    it("unknown id with an invalid body → 400 (validation precedes existence)", async () => {
      expectError(await patch(UNKNOWN_ID, { capacity: 0 }), 400, "VALIDATION_ERROR");
    });

    it("malformed id with a valid body → 404", async () => {
      expectError(await patch("abc", { capacity: 6 }), 404, "NOT_FOUND");
    });
  });
});

describe("DELETE /tables/:id", () => {
  it("US2 #6: soft-deletes the table and frees its name", async () => {
    const table = await create("T1");
    const res = await del(table.id);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");

    expect((await list()).body).toEqual([]);
    expectError(await get(table.id), 404, "NOT_FOUND");

    const again = await create("T1");
    expect(again.id).not.toBe(table.id);

    expectError(await get(table.id), 404, "NOT_FOUND");
    expectError(await patch(table.id, { capacity: 2 }), 404, "NOT_FOUND");
    expectError(await del(table.id), 404, "NOT_FOUND");

    const stored = await Table.findById(table.id).lean();
    expect(stored?.removed).toBe(true);
    expect(stored?.removedAt).toBeInstanceOf(Date);
  });
});

describe("US2 #7: unknown and malformed ids → 404", () => {
  it.each([UNKNOWN_ID, "abc"])("id %s", async (id) => {
    expectError(await get(id), 404, "NOT_FOUND");
    expectError(await patch(id, { capacity: 2 }), 404, "NOT_FOUND");
    expectError(await del(id), 404, "NOT_FOUND");
  });
});
