import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SCREENS } from "./support/screens";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function serious(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

for (const screen of SCREENS) {
  test(`axe: ${screen.name}`, async ({ page }) => {
    await screen.open(page);
    expect(await serious(page)).toEqual([]);
  });

  test(`axe with forced colors and reduced motion: ${screen.name}`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await screen.open(page);
    expect(await serious(page)).toEqual([]);
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration ?? 0) > 0)
          .map((a) => a.id || a.constructor.name),
    );
    expect(running, "running animations").toEqual([]);
  });
}
