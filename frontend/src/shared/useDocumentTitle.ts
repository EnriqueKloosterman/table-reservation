import { useEffect } from "react";
import { SERVICE_NAME } from "./ui/PageShell";

/** Sets `document.title` to "<step or outcome> - Table reservation" while the screen is shown. */
export function useDocumentTitle(step: string): void {
  useEffect(() => {
    document.title = `${step} - ${SERVICE_NAME}`;
  }, [step]);
}
