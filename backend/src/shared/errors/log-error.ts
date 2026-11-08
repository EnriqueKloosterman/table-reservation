const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,60}$/;

/** A short identifier (`name` or `code`) or `undefined`; anything else could carry data. */
function token(value: unknown): string | undefined {
  const text = typeof value === "number" ? String(value) : value;
  return typeof text === "string" && SAFE_TOKEN.test(text) ? text : undefined;
}

/**
 * Logs an unexpected error as one JSON line with the event, the error `name` and its `code`.
 * The message, the stack, `cause` and every other field are never written: driver and
 * validation errors can embed the values involved (a duplicate-key error holds the secret code
 * hash, others the guest address or name).
 */
export function logUnexpectedError(event: string, err: unknown): void {
  const name = err instanceof Error ? token(err.name) : undefined;
  const code = typeof err === "object" && err !== null ? token((err as { code?: unknown }).code) : undefined;
  console.error(JSON.stringify({ event, reason: name ?? "Unknown", ...(code && { code }) }));
}
