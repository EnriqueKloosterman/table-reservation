import type { ReactNode } from "react";

export const SERVICE_NAME = "Table reservation";

/** Landmarks only; each page supplies its own single h1 inside `children`. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="shell__header">
        <p className="shell__name">{SERVICE_NAME}</p>
      </header>
      <main className="shell__main">{children}</main>
      <footer className="shell__footer">
        <p>Bookings are confirmed by email.</p>
      </footer>
    </div>
  );
}
