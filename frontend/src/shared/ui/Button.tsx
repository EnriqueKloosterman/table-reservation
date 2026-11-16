import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  /** While busy the button is disabled and shows `busyLabel`. */
  busy?: boolean;
  busyLabel?: string;
  variant?: "primary" | "secondary";
}

export function Button({
  children,
  busy = false,
  busyLabel,
  variant = "primary",
  disabled,
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || busy}
      className={["button", `button--${variant}`, className].filter(Boolean).join(" ")}
    >
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
