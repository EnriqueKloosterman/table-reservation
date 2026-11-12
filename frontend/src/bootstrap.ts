import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createApiClient } from "./api/client";
import { readConfig } from "./config/env";

interface BootstrapOptions {
  rawApiBaseUrl: string | undefined;
}

export function bootstrap(rootElement: HTMLElement, { rawApiBaseUrl }: BootstrapOptions): void {
  const config = readConfig(rawApiBaseUrl);
  // An invalid configuration gets its own screen in the accessibility story; nothing is rendered yet.
  if (!config.ok) return;
  const client = createApiClient({ baseUrl: config.apiBaseUrl });
  createRoot(rootElement).render(
    createElement(StrictMode, null, createElement(App, { client, initialCancelCode: null })),
  );
}
