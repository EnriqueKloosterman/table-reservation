import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { App } from "../../src/App";
import type { ApiClient } from "../../src/api/types";

interface RenderAppOptions {
  client: ApiClient;
  path?: string;
  initialCancelCode?: string | null;
  strict?: boolean;
}

export function renderApp({
  client,
  path = "/",
  initialCancelCode = null,
  strict = true,
}: RenderAppOptions) {
  history.replaceState(null, "", path);
  const app = <App client={client} initialCancelCode={initialCancelCode} />;
  return render(strict ? <StrictMode>{app}</StrictMode> : app);
}
