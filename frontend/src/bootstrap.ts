import { StrictMode, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { createApiClient } from "./api/client";
import { readConfig } from "./config/env";

interface BootstrapOptions {
  rawApiBaseUrl: string | undefined;
}

/**
 * Reads the cancellation code from the address fragment and removes the fragment at once, so the
 * code is never left in the address bar, the history or a referrer. Runs outside React, because a
 * second read in a double-invoked initialiser would find nothing (research R8).
 */
export function takeCodeFromFragment(): string | null {
  const hash = window.location.hash;
  if (hash === "") return null;
  const code = new URLSearchParams(hash.slice(1)).get("code");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  const trimmed = code?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function bootstrap(rootElement: HTMLElement, { rawApiBaseUrl }: BootstrapOptions): Root {
  const root = createRoot(rootElement);
  const initialCancelCode = window.location.pathname === "/cancel" ? takeCodeFromFragment() : null;
  const config = readConfig(rawApiBaseUrl);
  // An invalid configuration gets its own screen in the accessibility story; nothing is rendered yet.
  if (!config.ok) return root;
  const client = createApiClient({ baseUrl: config.apiBaseUrl });
  root.render(createElement(StrictMode, null, createElement(App, { client, initialCancelCode })));
  return root;
}
