import { decodeJwt } from "jose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { StaffMember } from "../../src/modules/auth/staff.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { loginAs } from "../helpers/login-as.js";
import { DEFAULT_STAFF, seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

type Details = { field: string; reason: string }[];
type LoginBody = { token: string; expiresAt: string; staff: { name: string; email: string } };

const CREDS = { email: DEFAULT_STAFF.email, password: DEFAULT_STAFF.password };

const T0 = new Date("2026-11-06T10:00:00.500Z");

function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => containsKey(v, key));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([k, v]) => k === key || containsKey(v, key));
  }
  return false;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("POST /auth/login", () => {
  it("US1 #1: signs in and returns a token with its expiry", async () => {
    await seedStaff();
    const app = buildTestApp({ now: T0 });
    const res = await request(app).post("/auth/login").send(CREDS);

    expect(res.status).toBe(200);
    const body = res.body as LoginBody;
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "staff", "token"]);
    expect(body.staff).toEqual({ name: "Ana", email: "ana@resto.com" });
    expect(body.expiresAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
    expect(body.expiresAt).toBe("2026-11-06T18:00:00.000Z");
    const claims = decodeJwt(body.token);
    expect(claims.exp! * 1000).toBe(new Date(body.expiresAt).getTime());
  });

  it("US1 #2: wrong password and unknown email give the same refusal", async () => {
    await seedStaff();
    const app = buildTestApp();
    const wrong = expectError(
      await request(app).post("/auth/login").send({ email: DEFAULT_STAFF.email, password: "nope" }),
      401,
      "INVALID_CREDENTIALS",
    );
    const unknown = expectError(
      await request(app)
        .post("/auth/login")
        .send({ email: "nobody@resto.com", password: DEFAULT_STAFF.password }),
      401,
      "INVALID_CREDENTIALS",
    );
    expect(wrong.message).toBe("Invalid email or password");
    expect(unknown.message).toBe(wrong.message);
  });

  it("US1 #5: normalizes the email before matching", async () => {
    await seedStaff();
    const res = await request(buildTestApp())
      .post("/auth/login")
      .send({ email: " Ana@Resto.com ", password: DEFAULT_STAFF.password });
    expect(res.status).toBe(200);
  });

  describe("validation", () => {
    const app = buildTestApp();
    const fieldsOf = async (body: unknown) => {
      const error = expectError(
        await request(app).post("/auth/login").send(body as object),
        400,
        "VALIDATION_ERROR",
      );
      return error.details as Details;
    };

    it("refuses a syntactically invalid email", async () => {
      expect((await fieldsOf({ email: "ana", password: "x" })).map((d) => d.field)).toEqual([
        "email",
      ]);
    });

    it("refuses an empty password", async () => {
      expect(
        (await fieldsOf({ email: "ana@resto.com", password: "" })).map((d) => d.field),
      ).toEqual(["password"]);
    });

    it("refuses a password longer than 1024 chars", async () => {
      const details = await fieldsOf({ email: "ana@resto.com", password: "p".repeat(1025) });
      expect(details.map((d) => d.field)).toEqual(["password"]);
    });

    it("refuses an unknown field", async () => {
      const details = await fieldsOf({ ...CREDS, remember: true });
      expect(details).toEqual([{ field: "remember", reason: "Unknown field" }]);
    });

    it("refuses a null email", async () => {
      const details = await fieldsOf({ email: null, password: "x" });
      expect(details.map((d) => d.field)).toEqual(["email"]);
    });
  });
});

describe("GET /auth/me", () => {
  it("US1 #6: returns the signed-in staff profile without secrets", async () => {
    await seedStaff();
    const app = buildTestApp();
    const token = await loginAs(app);
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "Ana", email: "ana@resto.com" });
    expect(containsKey(res.body, "password")).toBe(false);
    expect(containsKey(res.body, "passwordHash")).toBe(false);
  });

  describe("US1 #3: missing or malformed proof", () => {
    const app = buildTestApp();
    it.each([
      ["no header", undefined],
      ["wrong scheme", "Basic x"],
      ["empty bearer", "Bearer "],
    ])("%s → 401", async (_label, header) => {
      const req = request(app).get("/auth/me");
      if (header !== undefined) void req.set("Authorization", header);
      const error = expectError(await req, 401, "AUTHENTICATION_REQUIRED");
      expect(error.message).toBe("Authentication required");
    });
  });

  describe("US1 #4: invalid tokens", () => {
    const expectRefused = async (app: ReturnType<typeof buildTestApp>, token: string) => {
      const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
      const error = expectError(res, 401, "AUTHENTICATION_REQUIRED");
      expect(error.message).toBe("Authentication required");
    };

    it("refuses an expired token", async () => {
      await seedStaff();
      const token = await loginAs(buildTestApp({ now: T0 }));
      const later = new Date(T0.getTime() + 8 * 3600_000 + 1000);
      await expectRefused(buildTestApp({ now: later }), token);
    });

    it("accepts the same token just before expiry", async () => {
      await seedStaff();
      const token = await loginAs(buildTestApp({ now: T0 }));
      const before = new Date(T0.getTime() + 7 * 3600_000);
      const res = await request(buildTestApp({ now: before }))
        .get("/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it("refuses a tampered signature", async () => {
      await seedStaff();
      const app = buildTestApp();
      const token = await loginAs(app);
      const [header, payload, signature] = token.split(".") as [string, string, string];
      const i = Math.floor(signature.length / 2);
      const flipped = signature[i] === "A" ? "B" : "A";
      const tampered = `${header}.${payload}.${signature.slice(0, i)}${flipped}${signature.slice(i + 1)}`;
      await expectRefused(app, tampered);
    });

    it("refuses an alg:none token", async () => {
      const staff = await seedStaff();
      const iat = Math.floor(Date.now() / 1000);
      const token = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({
        sub: staff.id,
        iat,
        exp: iat + 3600,
      })}.`;
      await expectRefused(buildTestApp(), token);
    });

    it("refuses a token signed with another secret", async () => {
      await seedStaff();
      const token = await loginAs(
        buildTestApp({ jwtSecret: "another-secret-that-is-also-32-chars-or-more" }),
      );
      await expectRefused(buildTestApp(), token);
    });

    it("refuses garbage", async () => {
      await expectRefused(buildTestApp(), "abc.def.ghi");
    });

    it("refuses a token for a staff member deleted after login", async () => {
      const staff = await seedStaff();
      const app = buildTestApp();
      const token = await loginAs(app);
      await StaffMember.deleteOne({ _id: staff.id });
      await expectRefused(app, token);
    });
  });

  it("check order: protected route without token is 401, unknown route is 404", async () => {
    const app = buildTestApp();
    expectError(await request(app).get("/auth/me"), 401, "AUTHENTICATION_REQUIRED");
    expectError(await request(app).get("/auth/nope"), 404, "NOT_FOUND");
  });
});
