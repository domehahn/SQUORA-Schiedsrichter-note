import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("schaltet zwischen Systemeinstellung, Hell und Dunkel um und merkt sich die Wahl", async ({ page }) => {
  await openApp(page);
  const root = page.locator("html");
  const toggle = page.getByRole("button", { name: /Anzeige:/ });

  // Startzustand: der Systemeinstellung folgend, kein data-theme gesetzt.
  await expect(root).not.toHaveAttribute("data-theme", /.+/);

  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", "light");

  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", "dark");

  await toggle.click();
  await expect(root).not.toHaveAttribute("data-theme", /.+/);

  // Eine explizite Wahl übersteht einen Reload (persistiert in localStorage).
  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
});
