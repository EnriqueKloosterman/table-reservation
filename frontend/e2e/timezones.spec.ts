import { expect, test } from "@playwright/test";
import { CREATE_OK, TIMES_OK, mockApi } from "./support/mock-api";
import { chooseDateAndParty, fillDetails } from "./support/screens";

// The same mocked answers must read identically in every visitor time zone (FR-029).
test("times and confirmation do not depend on the visitor's time zone", async ({ page }) => {
  await mockApi(page, { times: TIMES_OK, create: CREATE_OK });
  await page.goto("/");
  await chooseDateAndParty(page);

  const radios = page.getByRole("radio");
  await expect(radios).toHaveCount(5);
  await expect(page.getByText("13:00", { exact: true })).toBeVisible();
  await expect(page.getByText("23:30", { exact: true })).toBeVisible();

  await page.getByRole("radio", { name: /23:30/ }).check();
  await fillDetails(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Your table is booked" })).toBeVisible();
  const list = page.getByRole("list", { name: "Booking details" });
  await expect(list).toContainText("Saturday 14 November 2026");
  await expect(list).toContainText("23:30");
  // The end time crosses the restaurant's midnight and is shown exactly as returned.
  await expect(list).toContainText("01:00");
  await expect(list).toContainText("4");
});

test("the cancellation link renders the page and loses its fragment before any request", async ({
  page,
}) => {
  const { requests } = await mockApi(page, {});
  await page.goto("/cancel#code=SECRET123");
  await expect(page.getByRole("heading", { level: 1, name: "Cancel your reservation" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(page.url()).not.toContain("SECRET123");
  expect(requests).toEqual([]);
});
