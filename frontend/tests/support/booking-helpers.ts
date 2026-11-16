import { screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

export async function chooseDateAndParty(user: UserEvent, date = "2026-11-14", party = "4") {
  await user.type(screen.getByLabelText("Date"), date);
  await user.type(screen.getByLabelText("Party size"), party);
}

export async function pickTime(user: UserEvent, time: string) {
  await user.click(await screen.findByRole("radio", { name: new RegExp(time) }));
}

export async function fillDetails(
  user: UserEvent,
  values = { name: "Ana Perez", email: "ana@example.com", phone: "+34 600 123 456" },
) {
  await user.type(screen.getByLabelText("Name"), values.name);
  await user.type(screen.getByLabelText("Email"), values.email);
  await user.type(screen.getByLabelText("Phone"), values.phone);
}

export async function bookUpTo(user: UserEvent, time = "20:00") {
  await chooseDateAndParty(user);
  await pickTime(user, time);
  await fillDetails(user);
}

/** Elements showing `text` on the page, leaving out the hidden live regions that repeat it. */
export function visibleText(text: string | RegExp): HTMLElement[] {
  return screen.queryAllByText(text).filter((el) => !el.closest("[role='alert'], [role='status']"));
}

export async function findVisibleText(text: string | RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const found = visibleText(text);
    if (found.length === 0) throw new Error(`Text not shown: ${String(text)}`);
    return found[0] as HTMLElement;
  });
}
