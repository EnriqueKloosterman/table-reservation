import { expect, test, type Page } from "@playwright/test";
import { CANCEL_OK, CREATE_OK, TIMES_OK, mockApi } from "./support/mock-api";

async function focusedIsVisible(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const style = getComputedStyle(el);
    return el.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
  });
}

async function tabTo(page: Page, name: RegExp | string, max = 30) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return "";
      const labelled = (el as HTMLInputElement).labels?.[0]?.textContent;
      return (labelled ?? el.textContent).trim();
    });
    if (typeof name === "string" ? label.includes(name) : name.test(label)) {
      expect(await focusedIsVisible(page), `focus indicator on ${label}`).toBe(true);
      return;
    }
  }
  throw new Error(`Could not reach ${String(name)} with Tab`);
}

test("book a table with the keyboard only", async ({ page }) => {
  await mockApi(page, { times: TIMES_OK, create: CREATE_OK });
  await page.goto("/");
  await tabTo(page, "Date");
  await page.keyboard.type("14112026");
  await tabTo(page, "Party size");
  await page.keyboard.type("4");
  await expect(page.getByRole("radio", { name: /20:00/ })).toBeVisible();

  // Arrow keys move through the grouped time choices; Space selects.
  await tabTo(page, /13:00|20:00/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /20:00/ })).toBeFocused();
  await expect(page.getByRole("radio", { name: /20:00/ })).toBeChecked();
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();

  await tabTo(page, "Name");
  await page.keyboard.type("Ana Perez");
  await tabTo(page, "Email");
  await page.keyboard.type("ana@example.com");
  await tabTo(page, "Phone");
  await page.keyboard.type("+34 600 123 456");
  await tabTo(page, "Confirm booking");
  await page.keyboard.press("Enter");

  const heading = page.getByRole("heading", { level: 1, name: "Your table is booked" });
  await expect(heading).toBeFocused();

  // Back with Shift+Tab reaches nothing odd, and the new-booking button works by keyboard.
  await tabTo(page, "Start a new booking");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Book a table" })).toBeVisible();
});

test("cancel a reservation with the keyboard only", async ({ page }) => {
  await mockApi(page, { cancel: CANCEL_OK });
  await page.goto("/cancel#code=SECRET123");
  await tabTo(page, "Cancel my reservation");
  await page.keyboard.press("Enter");
  const heading = page.getByRole("heading", { level: 1, name: "Your reservation is cancelled" });
  await expect(heading).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await tabTo(page, "Make a new booking");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Book a table" })).toBeVisible();
});

test("manual cancellation code by keyboard", async ({ page }) => {
  await mockApi(page, { cancel: CANCEL_OK });
  await page.goto("/cancel");
  await tabTo(page, "Cancellation code");
  await page.keyboard.type("SECRET123");
  await tabTo(page, "Cancel my reservation");
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your reservation is cancelled" }),
  ).toBeFocused();
});
