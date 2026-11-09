import { createHash, randomBytes } from "node:crypto";

/** 256 random bits as 43 base64url characters (research R8). Returned once, never stored. */
export function generateSecretCode(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256 hex digest stored in `secretCodeHash`. A slow password hash is unnecessary for a
 * 256-bit random value, and a plain digest lets the cancellation feature look it up.
 */
export function hashSecretCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
