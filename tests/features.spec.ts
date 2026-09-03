import { expect, test, type Page } from "@playwright/test";
import { openApp, passGate } from "./helpers";

const MATCH_KEY_PREFIX = "squora-referee-note-match-v1:";

function matchKey(page: Page): Promise<string> {
  return page.evaluate((prefix) => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith(prefix));
    if (!key) throw new Error("no match key in localStorage");
    return key;
  }, MATCH_KEY_PREFIX);
}

test("erfasst eine Zeitstrafe, bearbeitet den Eintrag, speichert und öffnet ihn wieder", async ({ page }) => {
  await openApp(page);
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

  await page.locator(".archive-table").getByRole("button", { name: "Öffnen" }).click();
  await expect(page.getByLabel("Name der Heimmannschaft")).toHaveValue("SV Test");
});

test("legt ein Turnier an und pfeift eine Ansetzung an", async ({ page }) => {
  await openApp(page);
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
  await openApp(page);
  const key = await matchKey(page);
  const forward = async (field: string) => {
    await page.evaluate(([k, f]) => {
      const state = JSON.parse(localStorage.getItem(k)!);
      state[f] = 900_000;
      state.runningSince = null;
      localStorage.setItem(k, JSON.stringify(state));
    }, [key, field]);
    await page.reload();
    await passGate(page);
  };

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
  await openApp(page);
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await page.getByRole("button", { name: "Vorkommnis" }).click();
  await page.locator(".modal textarea").fill("Trinkpause wegen Hitze");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.locator(".event-table")).toContainText("Trinkpause wegen Hitze");
});

test("importiert einen Kader aus einer DFBnet-CSV", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Mannschaftsaufstellungen" }).click();

  const csv = [
    "Name Künstlername;Vorname Rufname;Geb.;Nat.;Passnummer;Spielrecht ab;Reg. am",
    "Testspieler ;Max (m) ;01.01.2014;XX;0100-0001;P 01.01.2026 F 01.01.2026;02.01.2026",
    "Beispiel ;Anna (w) ;02.02.2014;XX;0100-0002;P 02.01.2026 F 02.01.2026;03.01.2026",
    "Musterkind ;Kim (d) ;03.03.2015;XX;0100-0003;P 03.01.2026 F 03.01.2026;04.01.2026",
  ].join("\n");

  const home = page.locator(".roster-editor > div").first();
  await home.locator("input[type='file']").setInputFiles({
    name: "FC_Beispielstadt_II-20260903.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });

  // frisch importierte Spieler landen unter "Nicht nominiert"
  const rows = home.locator(".roster-group.group-out .roster-table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator(".roster-name")).toHaveValue("Max Testspieler");
  await expect(rows.nth(0).locator(".roster-pass")).toHaveValue("0100-0001");
  await expect(rows.nth(1).locator(".roster-name")).toHaveValue("Anna Beispiel");

  // aufstellen: einen Spieler auf "Aufgestellt" setzen
  await rows.nth(0).locator(".roster-status").selectOption("start");
  await expect(home.locator(".roster-group.group-start .roster-table tbody tr")).toHaveCount(1);
});

test("wählt im Erfassungsdialog einen Spieler aus der Aufstellung", async ({ page }) => {
  await openApp(page);
  await page.getByLabel("Name der Heimmannschaft").fill("SV Kader");
  await page.getByRole("button", { name: "Mannschaftsaufstellungen" }).click();
  const home = page.locator(".roster-editor > div").first();
  await home.locator("input[type='file']").setInputFiles({
    name: "team.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name Künstlername;Vorname Rufname;Geb.\nMeier ;Anna (w) ;01.01.2015\nKern ;Ben (m) ;02.02.2015", "utf-8"),
  });
  await home.locator(".roster-group.group-out .roster-table tbody tr").first().locator(".roster-status").selectOption("start");
  await page.getByRole("button", { name: "Mannschaftsaufstellungen" }).click();

  await page.getByRole("button", { name: "Spiel starten" }).click();
  await page.locator(".team-actions.home").getByRole("button", { name: "Tor Heim", exact: true }).click();
  await page.locator(".modal select").first().selectOption({ label: "Anna Meier" });
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await expect(page.locator(".event-table")).toContainText("Tor SV Kader · Anna Meier");
});

test("trennt Vereinsdaten: neuer Verein sieht das Archiv des anderen nicht", async ({ page }) => {
  await openApp(page); // legt "Testverein" an
  await page.getByLabel("Name der Heimmannschaft").fill("Verein-A-Team");
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await page.locator(".team-actions.home").getByRole("button", { name: "Tor Heim", exact: true }).click();
  await page.locator(".modal input").first().fill("5");
  await page.getByRole("button", { name: "Ereignis speichern" }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".archive-table")).toContainText("Verein-A-Team");

  // Verein sperren -> Gate -> zweiten Verein anlegen
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Testverein/ }).click();
  await page.getByRole("button", { name: /Weiteren Verein anlegen/ }).click();
  await page.getByLabel("Vereinsname").fill("Zweiter Verein");
  const password = page.locator(".tenant-card input[type='password']");
  await password.nth(0).fill("anderes-geheimnis");
  await password.nth(1).fill("anderes-geheimnis");
  await page.getByRole("button", { name: /Verein anlegen/ }).click();

  await expect(page.locator("#setup-title")).toBeVisible();
  await expect(page.getByRole("button", { name: /Zweiter Verein/ })).toBeVisible();
  await expect(page.locator(".archive-table")).toHaveCount(0);
  await expect(page.getByText("Noch keine gespeicherten Spiele")).toBeVisible();
});
