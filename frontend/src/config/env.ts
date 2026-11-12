export type Config = { ok: true; apiBaseUrl: string } | { ok: false };

export function readConfig(raw: string | undefined): Config {
  if (raw === undefined || raw === "") return { ok: false };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
  if (url.username !== "" || url.password !== "") return { ok: false };
  if (url.search !== "" || url.hash !== "") return { ok: false };
  if (raw.includes("?") || raw.includes("#")) return { ok: false };
  if (url.pathname !== "/" && url.pathname !== "") return { ok: false };
  return { ok: true, apiBaseUrl: `${url.protocol}//${url.host}` };
}
