import { SignJWT, jwtVerify } from "jose";

const OBJECT_ID = /^[0-9a-f]{24}$/;

function keyOf(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signToken({
  staffId,
  secret,
  expiresInSeconds,
  now,
}: {
  staffId: string;
  secret: string;
  expiresInSeconds: number;
  now: Date;
}): Promise<{ token: string; expiresAt: Date }> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + expiresInSeconds;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(staffId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(keyOf(secret));
  return { token, expiresAt: new Date(exp * 1000) };
}

/** Verifies an HS256 token at `now`. Throws on any failure (signature, expiry, claims). */
export async function verifyToken(
  token: string,
  { secret, now }: { secret: string; now: Date },
): Promise<{ staffId: string }> {
  const { payload } = await jwtVerify(token, keyOf(secret), {
    algorithms: ["HS256"],
    currentDate: now,
    requiredClaims: ["sub", "exp"],
  });
  if (typeof payload.sub !== "string" || !OBJECT_ID.test(payload.sub)) {
    throw new Error("Invalid subject claim");
  }
  return { staffId: payload.sub };
}
