import { ApiClientProvider } from "./api/context";
import type { ApiClient } from "./api/types";
import { BookingPage } from "./features/booking/BookingPage";
import { LiveRegionProvider } from "./shared/a11y/LiveRegion";
import { usePathname } from "./shared/router";
import { PageShell } from "./shared/ui/PageShell";

interface AppProps {
  client: ApiClient;
  /** Cancellation code taken from the link before the first render (used by the cancel page). */
  initialCancelCode?: string | null;
}

export function App({ client }: AppProps) {
  // The cancellation page is added with its own story; every known path shows the booking page for now.
  usePathname();
  return (
    <ApiClientProvider client={client}>
      <LiveRegionProvider>
        <PageShell>
          <BookingPage />
        </PageShell>
      </LiveRegionProvider>
    </ApiClientProvider>
  );
}
