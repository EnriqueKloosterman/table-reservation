import { useState } from "react";
import { ApiClientProvider } from "./api/context";
import type { ApiClient } from "./api/types";
import { BookingPage } from "./features/booking/BookingPage";
import { CancelPage, type CodeHandover } from "./features/cancel/CancelPage";
import { LiveRegionProvider } from "./shared/a11y/LiveRegion";
import { usePathname } from "./shared/router";
import { PageShell } from "./shared/ui/PageShell";

interface AppProps {
  client: ApiClient;
  /** Cancellation code taken from the link before the first render (used by the cancel page). */
  initialCancelCode?: string | null;
}

function createHandover(code: string | null): CodeHandover {
  let pending = code;
  return {
    peek: () => pending,
    clear: () => {
      pending = null;
    },
  };
}

export function App({ client, initialCancelCode = null }: AppProps) {
  const path = usePathname();
  // The code is handed over once: after the cancel page took it, coming back never restores it.
  const [handover] = useState(() => createHandover(initialCancelCode));
  return (
    <ApiClientProvider client={client}>
      <LiveRegionProvider>
        <PageShell>
          {path === "/cancel" ? (
            <CancelPage handover={handover} />
          ) : (
            <BookingPage />
          )}
        </PageShell>
      </LiveRegionProvider>
    </ApiClientProvider>
  );
}
