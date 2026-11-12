import { screen } from "@testing-library/react";
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
