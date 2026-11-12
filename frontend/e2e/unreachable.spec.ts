import { expect, test } from "@playwright/test";
import { TIMES_OK, mockApi, type Reply } from "./support/mock-api";
import { chooseDateAndParty, fillDetails } from "./support/screens";

const WITHIN = { timeout: 10_000 };

const CASES: { label: string; reply: Reply }[] = [
  { label: "connection refused", reply: { abort: true } },
  { label: "a server that never answers", reply: { never: true } },
];

for (const { label, reply } of CASES) {
  test.describe(label, () => {
    test("booking times show the unreachable message with a retry", async ({ page }) => {
      await mockApi(page, { times: reply });
      await page.goto("/");
      await chooseDateAndParty(page);
      await expect(page.getByText("We can't reach the server right now.").first()).toBeVisible(WITHIN);
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    });

    test("booking submit says the outcome is unknown, with a retry", async ({ page }) => {
      await mockApi(page, { times: TIMES_OK, create: reply });
      await page.goto("/");
      await chooseDateAndParty(page);
      await page.getByRole("radio", { name: /20:00/ }).check();
      await fillDetails(page);
      await page.getByRole("button", { name: "Confirm booking" }).click();
      await expect(
        page.getByText(/We don't know whether your reservation was made/).first(),
      ).toBeVisible(WITHIN);
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    });

    test("cancel shows the temporary-failure message with a retry", async ({ page }) => {
      await mockApi(page, { cancel: reply });
      await page.goto("/cancel#code=SECRET123");
      await page.getByRole("button", { name: "Cancel my reservation" }).click();
      await expect(
        page.getByText("We couldn't complete the cancellation just now.").first(),
      ).toBeVisible(WITHIN);
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    });
  });
}
