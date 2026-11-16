import { CLIENT_MESSAGES } from "../../api/messages";
import { useDocumentTitle } from "../../shared/useDocumentTitle";

/** Shown when the server address is missing or invalid. No retry: it needs a new build. */
export function ServiceUnavailable() {
  useDocumentTitle("Service not available");
  const { title, body, next } = CLIENT_MESSAGES.config;
  return (
    <section>
      <h1>Service not available</h1>
      <div className="status status--error">
        <p className="status__title">{title}</p>
        <p>{body}</p>
        {next ? <p>{next}</p> : null}
      </div>
    </section>
  );
}
