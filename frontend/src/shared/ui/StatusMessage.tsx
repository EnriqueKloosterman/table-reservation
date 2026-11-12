import type { ReactNode } from "react";
import type { Message } from "../../api/messages";

interface StatusMessageProps {
  message: Message;
  variant?: "info" | "error";
  children?: ReactNode;
}

export function StatusMessage({ message, variant = "info", children }: StatusMessageProps) {
  return (
    <div className={`status status--${variant}`}>
      <p className="status__title">
        {variant === "error" ? <span className="status__prefix">Problem: </span> : null}
        {message.title}
      </p>
      {message.body ? <p>{message.body}</p> : null}
      {message.next ? <p>{message.next}</p> : null}
      {children}
    </div>
  );
}
