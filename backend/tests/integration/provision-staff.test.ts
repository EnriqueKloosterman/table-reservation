import request from "supertest";
import { describe, expect, it } from "vitest";
import { verifyPassword } from "../../src/modules/auth/password.js";
import {
  ProvisionConfigError,
  parseProvisionEnv,
  provisionStaff,
} from "../../src/modules/auth/provision-staff.js";
import { StaffMember } from "../../src/modules/auth/staff.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

const validEnv = {
  MONGODB_URI: "mongodb://localhost:27017/x",
  STAFF_NAME: " Ana ",
  STAFF_EMAIL: " Ana@Resto.com ",
  STAFF_PASSWORD: "correct horse battery",
};

function provisionErrorOf(env: Record<string, string | undefined>): ProvisionConfigError {
  try {
    parseProvisionEnv(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ProvisionConfigError);
    return err as ProvisionConfigError;
  }
  throw new Error("parseProvisionEnv did not throw");
}

describe("parseProvisionEnv", () => {
  it("normalizes valid input", () => {
    expect(parseProvisionEnv(validEnv)).toEqual({
      mongoUri: validEnv.MONGODB_URI,
      name: "Ana",
      email: "ana@resto.com",
      password: "correct horse battery",
    });
  });

  it.each([
    ["MONGODB_URI", { MONGODB_URI: undefined }],
    ["STAFF_NAME", { STAFF_NAME: undefined }],
    ["STAFF_NAME", { STAFF_NAME: "n".repeat(101) }],
    ["STAFF_EMAIL", { STAFF_EMAIL: "ana" }],
    ["STAFF_PASSWORD", { STAFF_PASSWORD: "" }],
    ["STAFF_PASSWORD", { STAFF_PASSWORD: "p".repeat(1025) }],
  ])("refuses invalid %s", (key, override) => {
    expect(provisionErrorOf({ ...validEnv, ...override }).keys).toEqual([key]);
  });

  it("lists every invalid key in one error and never echoes the password", () => {
    const secret = `s3cr3t-${"p".repeat(1025)}`;
    const err = provisionErrorOf({
      MONGODB_URI: "",
      STAFF_NAME: "",
      STAFF_EMAIL: "ana",
      STAFF_PASSWORD: secret,
    });
    expect([...err.keys].sort()).toEqual([
      "MONGODB_URI",
      "STAFF_EMAIL",
      "STAFF_NAME",
      "STAFF_PASSWORD",
    ]);
    expect(err.message).not.toContain("s3cr3t");
    expect(JSON.stringify(err)).not.toContain("s3cr3t");
  });
});

describe("provisionStaff", () => {
  const input = { name: "Ana", email: "ana@resto.com", password: "correct horse battery" };

  it("creates the account with a hashed password", async () => {
    expect(await provisionStaff(input)).toBe("created");
    const docs = await StaffMember.find().select("+passwordHash").lean();
    expect(docs).toHaveLength(1);
    const doc = docs[0]!;
    expect(doc.email).toBe("ana@resto.com");
    expect(doc.passwordHash).toMatch(/^scrypt\$/);
    expect(await verifyPassword(input.password, doc.passwordHash)).toBe(true);
    expect(JSON.stringify(doc)).not.toContain(input.password);
  });

  it("is idempotent for the same (normalized) email", async () => {
    await provisionStaff(input);
    const before = await StaffMember.findOne().select("+passwordHash").lean();
    const again = parseProvisionEnv({
      ...validEnv,
      STAFF_NAME: "Other",
      STAFF_EMAIL: " ANA@resto.com ",
      STAFF_PASSWORD: "different password",
    });
    expect(await provisionStaff(again)).toBe("exists");
    const docs = await StaffMember.find().select("+passwordHash").lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.name).toBe(before!.name);
    expect(docs[0]!.passwordHash).toBe(before!.passwordHash);
  });

  it("creates exactly one account under concurrent runs", async () => {
    const results = await Promise.all([provisionStaff(input), provisionStaff(input)]);
    expect([...results].sort()).toEqual(["created", "exists"]);
    expect(await StaffMember.countDocuments()).toBe(1);
  });

  it("the provisioned account can sign in", async () => {
    await provisionStaff(input);
    const res = await request(buildTestApp())
      .post("/auth/login")
      .send({ email: input.email, password: input.password });
    expect(res.status).toBe(200);
  });
});
