import type { Response } from "supertest";
import { expect } from "vitest";
import type { z } from "zod";
import { ErrorResponseSchema } from "../../src/shared/openapi/common.js";

type ErrorBody = z.infer<typeof ErrorResponseSchema>["error"];

/**
 * Asserts the response is an error in the standard shape with the given status and code,
 * and returns `body.error` for further assertions.
 */
export function expectError(res: Response, status: number, code: string): ErrorBody {
  expect(res.status).toBe(status);
  expect(res.headers["content-type"]).toMatch(/application\/json/);
  const parsed = ErrorResponseSchema.safeParse(res.body);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  const body = parsed.data!;
  expect(body.error.code).toBe(code);
  return body.error;
}
