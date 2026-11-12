import { expect, test, type Page } from "@playwright/test";
import { SCREENS } from "./support/screens";

async function overflowAndTargets(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const small: string[] = [];
    const targets = document.querySelectorAll<HTMLElement>(
      "button, a[href], input:not([type=hidden]), select, textarea, [role=button]",
    );
    for (const el of targets) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // A radio is activated through its label, which is what the visitor sees and taps.
      const box = (el instanceof HTMLInputElement && el.type === "radio" ? el.closest("label") : null) ?? el;
      const rect = box.getBoundingClientRect();
      if (rect.width < 43.5 || rect.height < 43.5) {
        small.push(`${el.tagName.toLowerCase()} ${(el.textContent || el.getAttribute("id") || "").trim().slice(0, 30)} ${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`);
      }
    }
    const main = document.querySelector("main")?.getBoundingClientRect();
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      small,
      mainWidth: main?.width ?? 0,
      innerWidth: window.innerWidth,
    };
  });
}

for (const screen of SCREENS) {
  test(`layout: ${screen.name}`, async ({ page }) => {
    await screen.open(page);
    const result = await overflowAndTargets(page);
    expect(result.scrollWidth, "horizontal overflow").toBeLessThanOrEqual(result.clientWidth);
    expect(result.small, "targets smaller than 44x44").toEqual([]);
    if (result.innerWidth > 900) {
      // 40rem content column; narrower than the viewport on wide screens.
      expect(result.mainWidth).toBeLessThan(result.innerWidth * 0.75);
    }
  });

  test(`layout at 200% text size: ${screen.name}`, async ({ page }) => {
    await screen.open(page);
    // Emulates the browser's text-size setting: the root font size doubles, rem units follow.
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const result = await overflowAndTargets(page);
    expect(result.scrollWidth, "horizontal overflow").toBeLessThanOrEqual(result.clientWidth);
  });
}
