import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Hashes a password as `scrypt$N$r$p$<saltB64>$<hashB64>` with a random salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

function parsePositiveInt(s: string): number | undefined {
  return /^[1-9]\d*$/.test(s) ? Number(s) : undefined;
}

/** Checks a password against a stored hash. Never throws: malformed input yields `false`. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, nText, rText, pText, saltText, hashText] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const n = parsePositiveInt(nText);
    const r = parsePositiveInt(rText);
    const p = parsePositiveInt(pText);
    if (!n || !r || !p || !BASE64.test(saltText) || !BASE64.test(hashText)) return false;

    const expected = Buffer.from(hashText, "base64");
    if (expected.length === 0) return false;
    const actual = await deriveKey(password, Buffer.from(saltText, "base64"), expected.length, {
      N: n,
      r,
      p,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Verified against when the email is unknown, so timing matches a wrong password. */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));
