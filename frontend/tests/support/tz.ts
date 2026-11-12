export async function withTimeZone<T>(tz: string, fn: () => T | Promise<T>): Promise<T> {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}
