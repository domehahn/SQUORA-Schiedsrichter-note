import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Regression guard for "text/button unreadable in dark mode": walks every
 * visible button and a sample of key text elements, resolves each one's
 * effective background (walking up through transparent ancestors) and
 * asserts a WCAG-style contrast ratio against its own text color. This is
 * deliberately lenient (>= 3:1, the WCAG AA threshold for large text/UI
 * components, not the stricter 4.5:1 for body copy) so it catches genuinely
 * broken pairs (dark-on-dark, light-on-light) without flagging intentionally
 * subtle secondary text.
 */
async function minContrastRatio(page: import("@playwright/test").Page): Promise<{ ratio: number; selector: string } | null> {
  return page.evaluate(() => {
    function toRgb(value: string): [number, number, number, number] | null {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => parseFloat(part.trim()));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts.length > 3 ? parts[3] : 1];
    }
    function luminance([r, g, b]: [number, number, number, number]): number {
      const channel = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }
    function effectiveBackground(el: Element): [number, number, number, number] {
      let node: Element | null = el;
      while (node) {
        const bg = toRgb(getComputedStyle(node).backgroundColor);
        if (bg && bg[3] > 0.5) return bg;
        node = node.parentElement;
      }
      return [255, 255, 255, 1]; // fall back to an assumed white page background
    }
    function describe(el: Element): string {
      const cls = el.className && typeof el.className === "string" ? `.${el.className.split(" ").filter(Boolean).join(".")}` : "";
      return `${el.tagName.toLowerCase()}${cls}`;
    }

    let worst: { ratio: number; selector: string } | null = null;
    const candidates = document.querySelectorAll<HTMLElement>("button, a, .pitch-slot-name, .position-chip-btn, .status-chip button, td, th");
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || parseFloat(style.opacity) === 0) continue;
      const text = (el.textContent ?? "").trim();
      if (!text) continue;
      const fg = toRgb(style.color);
      if (!fg) continue;
      const bg = fg[3] < 0.5 ? effectiveBackground(el) : (toRgb(style.backgroundColor)?.[3] ?? 0) > 0.5 ? toRgb(style.backgroundColor)! : effectiveBackground(el);
      const l1 = luminance(fg) + 0.05;
      const l2 = luminance(bg) + 0.05;
      const ratio = l1 > l2 ? l1 / l2 : l2 / l1;
      if (worst === null || ratio < worst.ratio) worst = { ratio, selector: describe(el) };
    }
    return worst;
  });
}

test("Dunkelmodus: Buttons und Texte bleiben lesbar (WCAG-Kontrast)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page);
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await page.locator(".team-actions.home").getByRole("button", { name: "Tor Heim", exact: true }).click();
  await page.locator(".modal input").first().fill("9");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await check(page, "Hauptbildschirm nach einem Tor");

  // The roster/pitch panel (position chips, pitch-slot name pills) — exactly
  // the area a user reported as unreadable.
  await page.getByRole("button", { name: "Mannschaftsaufstellungen" }).click();
  await check(page, "Mannschaftsaufstellungen (Skizze + Kader-Tabelle)");

  await page.getByRole("button", { name: "Spielzeiten" }).click();
  await check(page, "Spielzeiten");
});

async function check(page: import("@playwright/test").Page, context: string): Promise<void> {
  const worst = await minContrastRatio(page);
  expect(worst, `no visible text elements found to check (${context})`).not.toBeNull();
  expect(worst!.ratio, `[${context}] lowest-contrast element: ${worst!.selector} at ${worst!.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
}
