import { createHash } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { cancelAsStaff, cancelWithCode } from "../helpers/cancel-as.js";
import { FakeEmailSender } from "../helpers/fake-email-sender.js";
import { loginAs } from "../helpers/login-as.js";
import { fetchOpenApi, operationsOf } from "../helpers/openapi.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, SC-007 / FR-002 / FR-020: the secret code (and its hash) appears in exactly one
// response, the creation response. Every operation of /openapi.json is called afterwards.
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const DATE = "2026-11-14";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SC-007: the secret code never leaves the creation response", () => {
  it("no response body or header of any operation contains the code, its hash or the secret keys", async () => {
    await seedStaff();
    await seedRestaurant({
      tables: [{ name: "Solo", capacity: 4 }],
      schedule: { saturday: [{ name: "Dinner", start: "18:00", end: "23:30" }] },
    });
    const app = buildTestApp({ now: NOW, emailSender: new FakeEmailSender("ok") });
    const token = await loginAs(app);

    const first = (await reserveAs(app, { email: "a@mail.com", time: "18:00", date: DATE })).body as {
      id: string;
      secretCode: string;
    };
    const second = (await reserveAs(app, { email: "b@mail.com", time: "21:00", date: DATE })).body as {
      id: string;
      secretCode: string;
    };
    const responses: request.Response[] = [];
    const openApiDocuments = new Set<request.Response>();
    responses.push(await cancelWithCode(app, first.secretCode));
    responses.push(await cancelAsStaff(app, second.id, token));

    // Feature 004: a third reservation that stays confirmed (its 21:00 slot was just freed).
    const third = (await reserveAs(app, { email: "c@mail.com", time: "21:00", date: DATE })).body as {
      id: string;
      secretCode: string;
    };
    const forbidden = [
      first.secretCode,
      second.secretCode,
      third.secretCode,
      sha256(first.secretCode),
      sha256(second.secretCode),
      sha256(third.secretCode),
    ];

    // The two staff reads answer 200 with real data (guest- and staff-cancelled, and confirmed):
    // the sweep must inspect these bodies, not only 400s.
    const staffReads = [
      await request(app).get("/reservations").query({ date: DATE, status: "all" }).set("Authorization", `Bearer ${token}`),
      await request(app).get(`/reservations/${first.id}`).set("Authorization", `Bearer ${token}`),
      await request(app).get(`/reservations/${second.id}`).set("Authorization", `Bearer ${token}`),
      await request(app).get(`/reservations/${third.id}`).set("Authorization", `Bearer ${token}`),
    ];
    for (const res of staffReads) expect(res.status).toBe(200);
    expect((staffReads[0]!.body as { reservations: unknown[] }).reservations).toHaveLength(3);
    responses.push(...staffReads);

    const doc = await fetchOpenApi(app);
    const values: Record<string, string> = { id: first.id, date: DATE };
    for (const { method, path } of operationsOf(doc)) {
      if (method === "POST" && path === "/reservations") continue; // the one place the code may appear
      const url = path.replace(/\{(\w+)\}/g, (_m, name: string) => values[name] ?? "x");
      const verb = method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
      let req = request(app)[verb](url).set("Authorization", `Bearer ${token}`);
      if (["post", "put", "patch"].includes(verb)) req = req.send({});
      const res = await req;
      responses.push(res);
      if (path === "/openapi.json") openApiDocuments.add(res);
    }
    // Staff views taken after the cancellations, with realistic inputs.
    responses.push(await request(app).get("/tables").set("Authorization", `Bearer ${token}`));
    responses.push(await request(app).get("/availability").query({ date: DATE, time: "18:00", partySize: "2" }));
    responses.push(await request(app).get("/availability/times").query({ date: DATE, partySize: "2" }));
    responses.push(
      await request(app).post("/closed-dates").set("Authorization", `Bearer ${token}`).send({ date: DATE }),
    );

    expect(responses.length).toBeGreaterThan(15);
    for (const res of responses) {
      const text = `${res.text}\n${JSON.stringify(res.headers)}`;
      for (const secret of forbidden) expect(text).not.toContain(secret);
      // The OpenAPI document names the `secretCode` field of the creation schema; it holds no value.
      if (openApiDocuments.has(res)) continue;
      expect(text).not.toContain("secretCode");
      expect(text).not.toContain("secretCodeHash");
    }
  });
});
