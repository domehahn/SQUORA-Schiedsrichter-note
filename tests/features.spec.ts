import { expect, test } from "@playwright/test";

test("erfasst eine Zeitstrafe, bearbeitet den Eintrag, speichert und öffnet ihn wieder", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Name der Heimmannschaft").fill("SV Test");
  await page.locator("select").first().selectOption("custom");
  await page.locator('input[type="number"]').first().fill("1");
  await page.getByRole("button", { name: "Spiel starten" }).click();

  await page.locator(".team-actions.home").getByRole("button", { name: "Zeitstrafe Heim", exact: true }).click();
  await page.locator(".modal input").first().fill("7");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();

  await expect(page.locator(".pen-badge")).toContainText("Nr. 7");
  await expect(page.locator(".event-table")).toContainText("Zeitstrafe");

  await page.locator(".event-table .row-timePenalty .mini-icon").first().click();
  await page.locator(".modal input").first().fill("9");
  await page.getByRole("button", { name: "Änderung speichern" }).click();
  await expect(page.locator(".event-table")).toContainText("Nr. 9");

  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".archive-table")).toContainText("SV Test");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Neues Spiel" }).click();
  await expect(page.getByLabel("Name der Heimmannschaft")).toHaveValue("Heim");

  await page.getByRole("button", { name: "Öffnen" }).click();
  await expect(page.getByLabel("Name der Heimmannschaft")).toHaveValue("SV Test");
});

test("legt ein Turnier an und pfeift eine Ansetzung an", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Turniere" }).click();

  page.once("dialog", (dialog) => dialog.accept("Sommercup"));
  await page.getByRole("button", { name: "Neues Turnier" }).click();
  await page.getByRole("button", { name: /Sommercup/ }).click();

  await page.getByRole("button", { name: "Spiel hinzufügen" }).click();
  await page.locator(".fixture-table input").nth(0).fill("Adler");
  await page.locator(".fixture-table input").nth(1).fill("Bären");

  await page.getByRole("button", { name: "Anpfiff", exact: true }).click();
  await expect(page.getByLabel("Name der Heimmannschaft")).toHaveValue("Adler");
  await expect(page.getByLabel("Name der Gastmannschaft")).toHaveValue("Bären");
  await expect(page.getByText("Teil eines Turniers", { exact: false })).toBeVisible();

  // Turnier archivieren und wiederherstellen
  const panelToggle = page.getByRole("button", { name: "Turniere" });
  if ((await panelToggle.getAttribute("aria-expanded")) !== "true") await panelToggle.click();
  if ((await page.getByRole("button", { name: "Archivieren", exact: true }).count()) === 0) {
    await page.getByRole("button", { name: /Sommercup/ }).click();
  }
  await page.getByRole("button", { name: "Archivieren", exact: true }).click();
  await expect(page.getByRole("button", { name: /Archivierte Turniere \(1\)/ })).toBeVisible();
  await page.getByRole("button", { name: /Archivierte Turniere/ }).click();
  await page.getByRole("button", { name: "Wiederherstellen", exact: true }).click();
  await expect(page.getByRole("button", { name: /Archivierte Turniere/ })).toHaveCount(0);
});

test("spielt ein K.-o.-Spiel bis ins Elfmeterschießen durch", async ({ page }) => {
  const key = "squora-referee-note-match-v1";
  const forward = async (field: string) => {
    await page.evaluate(([k, f]) => {
      const state = JSON.parse(localStorage.getItem(k)!);
      state[f] = 900_000;
      state.runningSince = null;
      localStorage.setItem(k, JSON.stringify(state));
    }, [key, field]);
    await page.reload();
  };

  await page.goto("/");
  await page.getByText("K.-o.-Spiel", { exact: false }).click();
  await page.locator("select").first().selectOption("custom");
  await page.locator('input[type="number"]').first().fill("1");
  await page.getByRole("button", { name: "Spiel starten" }).click();

  await forward("firstHalfMs");
  await page.getByRole("button", { name: "Halbzeit", exact: true }).click();
  await page.getByRole("button", { name: "2. Halbzeit starten" }).click();
  await forward("secondHalfMs");
  await page.getByRole("button", { name: "Verlängerung", exact: true }).click();

  await forward("extraFirstMs");
  await page.getByRole("button", { name: "Ende 1. HZ Verl." }).click();
  await page.getByRole("button", { name: "2. HZ Verl. starten" }).click();
  await forward("extraSecondMs");
  await page.getByRole("button", { name: "Elfmeterschießen" }).click();

  await expect(page.locator(".shootout-panel")).toBeVisible();
  for (let round = 0; round < 3; round += 1) {
    await page.getByRole("button", { name: "Tor", exact: true }).click();
    await page.getByRole("button", { name: "Kein Tor", exact: true }).click();
  }
  await page.getByRole("button", { name: /Spiel beenden/ }).click();
  await expect(page.getByText("Beendet", { exact: true })).toBeVisible();
  await expect(page.locator(".event-table")).toContainText("Sieg im Elfmeterschießen");
});

test("erfasst ein Vorkommnis ohne Mannschaftsbezug", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await page.getByRole("button", { name: "Vorkommnis" }).click();
  await page.locator(".modal textarea").fill("Trinkpause wegen Hitze");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.locator(".event-table")).toContainText("Trinkpause wegen Hitze");
});
