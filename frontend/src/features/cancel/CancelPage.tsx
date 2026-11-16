import { useEffect, useState } from "react";
import { CLIENT_MESSAGES } from "../../api/messages";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { useDocumentTitle } from "../../shared/useDocumentTitle";
import { OutcomeView, messageFor } from "./OutcomeViews";
import { useCancellation } from "./useCancellation";

/** Holds the code from the link until the cancel page has taken it into its own state. */
export interface CodeHandover {
  peek: () => string | null;
  clear: () => void;
}

export function CancelPage({ handover }: { handover: CodeHandover }) {
  const [initialCode] = useState(() => handover.peek());
  const cancellation = useCancellation(initialCode);
  useEffect(() => {
    handover.clear();
  }, [handover]);

  useDocumentTitle(
    cancellation.outcome ? messageFor(cancellation.outcome).title : "Cancel your reservation",
  );

  if (cancellation.outcome) return <OutcomeView outcome={cancellation.outcome} />;

  const hasLinkCode = initialCode !== null;
  const { submitting, failed } = cancellation;
  return (
    <section>
      <h1>Cancel your reservation</h1>
      <StatusMessage
        message={hasLinkCode ? CLIENT_MESSAGES.cancelReady : CLIENT_MESSAGES.cancelMissingCode}
      />
      {hasLinkCode ? null : (
        <Field
          label="Cancellation code"
          autoComplete="off"
          spellCheck={false}
          value={cancellation.code}
          disabled={submitting}
          onChange={(event) => {
            cancellation.setCode(event.currentTarget.value);
          }}
        />
      )}
      {failed ? (
        <StatusMessage message={CLIENT_MESSAGES.cancelTemporary} variant="error">
          <Button
            disabled={submitting}
            onClick={() => {
              void cancellation.submit();
            }}
          >
            Try again
          </Button>
        </StatusMessage>
      ) : (
        <Button
          busy={submitting}
          busyLabel="Cancelling..."
          disabled={!cancellation.canSubmit}
          onClick={() => {
            void cancellation.submit();
          }}
        >
          Cancel my reservation
        </Button>
      )}
    </section>
  );
}
