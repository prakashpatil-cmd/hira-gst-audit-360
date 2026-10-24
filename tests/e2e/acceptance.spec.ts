/**
 * Minimum end-to-end acceptance test (prompt §23, steps 1–19) driven through the real UI.
 * Step 20 (deployed Vercel application) is run against a deployment with E2E_BASE_URL — see docs/DEPLOYMENT.md.
 */
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import type ExcelJSType from "exceljs";
const ExcelJS = createRequire(import.meta.url)("exceljs") as typeof ExcelJSType;
import { makeGstin } from "../../src/lib/gst/gstin";
import { ADMIN } from "./global-setup";

const PW = "Team@Hira2026!";
const PAN = "AABCH2468K";
const G = { MH: makeGstin("27", PAN), KA: makeGstin("29", PAN), WB: makeGstin("19", PAN) };
const USERS = {
  manager: { email: "manager@hira.test", name: "Meera Kulkarni", role: "audit_manager" },
  auditor1: { email: "auditor1@hira.test", name: "Rohan Desai", role: "gst_auditor" },
  auditor2: { email: "auditor2@hira.test", name: "Sana Shaikh", role: "gst_auditor" },
  outsider: { email: "outsider@hira.test", name: "Unassigned Auditor", role: "gst_auditor" },
};
const DEMO = "samples/demo";
let engagementUrl = "";

async function login(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|portal)/);
}

async function importFile(page: Page, dataset: string, file: string, gstin: string | null, opts: { append?: boolean } = {}) {
  await page.goto(`${engagementUrl}/imports`);
  await page.locator('select[name="dataset_type"]').selectOption(dataset);
  if (gstin) {
    const value = await page.locator('select[name="client_gstin_id"] option', { hasText: gstin }).first().getAttribute("value");
    await page.locator('select[name="client_gstin_id"]').selectOption(value!);
  }
  await page.locator('input[name="file"]').setInputFiles(`${DEMO}/${file}`);
  await page.getByRole("button", { name: "Upload and map" }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}/);
  if (opts.append) {
    await page.locator('select[name="mode"]').selectOption("append");
    await page.getByRole("button", { name: "Save mapping" }).click();
    await expect(page.getByText("Mapping saved")).toBeVisible();
  }
  await page.getByRole("button", { name: /Validate all rows/ }).click();
  await expect(page.getByRole("button", { name: "3. Commit to audit data" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Import quality report")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "3. Commit to audit data" }).click();
  await expect(page.getByText("committed").first()).toBeVisible({ timeout: 120_000 });
}

test.describe.serial("§23 minimum end-to-end acceptance", () => {
  test("1–5: Super Administrator sets up the team, client, registrations and engagement", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);                                                         // 1
    await expect(page.getByRole("heading", { name: "Firm dashboard" })).toBeVisible();
    await page.goto("/admin/users");
    for (const u of Object.values(USERS)) {
      await page.locator('input[name="full_name"]').fill(u.name);
      await page.locator('input[name="email"]').fill(u.email);
      await page.locator('select[name="role"]').last().selectOption(u.role);
      await page.locator('input[name="password"]').last().fill(PW);
      await page.getByRole("button", { name: "Create user" }).click();
      await expect(page.getByText(`User ${u.email} created`)).toBeVisible();
    }
    await page.goto("/clients/new");                                                                        // 2
    await page.locator('input[name="legal_name"]').fill("Helix Diagnostics Manufacturing Private Limited");
    await page.locator('input[name="pan"]').fill(PAN);
    await page.locator('input[name="industry"]').fill("Diagnostics manufacturing");
    await page.locator('input[name="accounting_software"]').fill("Tally Prime");
    await page.locator('input[name="aato_crore"]').fill("120");
    for (const f of ["is_exporter", "is_importer", "einvoice_applicable"]) await page.locator(`input[name="${f}"]`).check();
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
    const clientUrl = page.url();
    await page.goto(`${clientUrl}?tab=gstins`);                                                              // 3
    for (const [label, g] of [["Maharashtra — Bhiwandi factory", G.MH], ["Karnataka — Bengaluru depot", G.KA], ["West Bengal — Kolkata branch", G.WB]]) {
      await page.locator('input[name="gstin"]').fill(g);
      await page.locator('input[name="label"]').fill(label);
      await page.locator('input[name="einvoice_applicable_from"]').fill("2023-08-01");
      await page.getByRole("button", { name: "Add GSTIN" }).click();
      await expect(page.getByText(`GSTIN ${g} added.`)).toBeVisible();
    }
    // an invalid GSTIN is refused by checksum validation
    await page.locator('input[name="gstin"]').fill(G.MH.slice(0, 14) + (G.MH[14] === "A" ? "B" : "A"));
    await page.getByRole("button", { name: "Add GSTIN" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /checksum/i })).toBeVisible();
    await page.goto(`${clientUrl}?tab=locations`);
    await page.locator('input[name="name"]').fill("Bhiwandi factory");
    await page.locator('select[name="location_type"]').selectOption("factory");
    await page.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByText("Location added.")).toBeVisible();

    await page.goto(`/engagements/new?client=${clientUrl.split("/").pop()}`);                                 // 4
    await page.locator('input[name="title"]').fill("GST Health Check — Q1 FY 2026-27");
    await page.locator('input[name="period_from"]').fill("2026-04-01");
    await page.locator('input[name="period_to"]').fill("2026-06-30");
    await page.locator('select[name="reviewing_manager_id"]').selectOption({ label: USERS.manager.name });   // 5: one manager
    for (const a of [USERS.auditor1, USERS.auditor2]) await page.getByLabel(a.name, { exact: true }).check();               // 5: two auditors
    await page.getByRole("button", { name: "Create engagement" }).click();
    await page.waitForURL(/\/engagements\/[0-9a-f-]{36}$/);
    engagementUrl = new URL(page.url()).pathname;
    await page.goto(`${engagementUrl}/team`);
    for (const u of [USERS.manager, USERS.auditor1, USERS.auditor2]) await expect(page.getByText(u.name).first()).toBeVisible();
    await page.goto(`${engagementUrl}/checklist`);
    await expect(page.getByText("C-ITC-").first()).toBeVisible();
  });

  test("6–9: auditor imports records, validates and maps them, and reconciliation detects inserted mismatches", async ({ page }) => {
    await login(page, USERS.auditor1.email, PW);
    await page.goto("/engagements");
    await expect(page.getByText("Helix Diagnostics")).toBeVisible();
    await importFile(page, "sales_register", "01_sales_register_MH.xlsx", G.MH);                          // 6–7
    await importFile(page, "purchase_register", "04_purchase_register_MH.csv", G.MH);
    await importFile(page, "gstr1", "02_gstr1_MH.csv", G.MH);
    await importFile(page, "gstr3b", "03_gstr3b_MH.csv", G.MH);
    await importFile(page, "gstr2b", "05_gstr2b_MH_042026.json", G.MH, { append: true });
    await importFile(page, "gstr2b", "05_gstr2b_MH_052026.json", G.MH, { append: true });
    await importFile(page, "gstr2b", "05_gstr2b_MH_062026.json", G.MH, { append: true });
    await importFile(page, "eway_bill_register", "06_eway_bills_MH.csv", G.MH);
    await page.goto(`${engagementUrl}/imports`);
    await expect(page.locator("tr", { hasText: "Sales register" }).getByText("committed")).toBeVisible();

    await page.goto(`${engagementUrl}/reconciliation`);                                                   // 8
    await page.getByRole("button", { name: "Run all reconciliations" }).click();
    await expect(page.getByText("reconciliation(s) started")).toBeVisible({ timeout: 180_000 });
    await page.reload();
    await expect(page.locator("tr", { hasText: "Books vs GSTR-1" }).getByText("completed")).toBeVisible();

    await page.goto(`${engagementUrl}/exceptions?q=HDM/2627/0004`);                                       // 9
    await expect(page.getByText("Outward supply recorded in the books but not reported in GSTR-1")).toBeVisible();
    for (const [q, label] of [["HDM/2627/0011", "under-reported in GSTR-1"], ["HDM/2627/9001", "not recorded in the sales register"], ["", "Cess field"]]) {
      await page.goto(`${engagementUrl}/exceptions${q ? `?q=${q}` : "?type=EWB_TAX_IN_CESS"}`);
      await expect(page.getByText(new RegExp(label, "i")).first()).toBeVisible();
    }
    // three planted supplier invoices, plus the FTWZ bill of entry flagged for ICEGATE verification
    // (the bill of entry register itself is not imported at this point of the walk-through)
    await page.goto(`${engagementUrl}/exceptions?type=CLAIMED_NOT_IN_2B`);
    await expect(page.locator("tbody tr")).toHaveCount(4);
    for (const doc of ["SWIFT/3", "TECHCARE/14", "PRECISION/26", "8047642"]) await expect(page.locator("tbody tr", { hasText: doc })).toHaveCount(1);
  });

  test("10–13: auditor investigates an exception from its source rows, classifies it, quantifies and documents it", async ({ page }) => {
    await login(page, USERS.auditor1.email, PW);
    await page.goto(`${engagementUrl}/exceptions?q=HDM/2627/0004`);
    await page.getByRole("link", { name: "Outward supply recorded in the books but not reported in GSTR-1" }).first().click();
    await page.waitForURL(/\/exceptions\/[0-9a-f-]{36}/);
    await expect(page.getByText("Original source records")).toBeVisible();                               // 10
    await expect(page.getByRole("cell", { name: "HDM/2627/0004" })).toBeVisible();
    await expect(page.getByText("01_sales_register_MH.xlsx")).toBeVisible();
    await page.locator('select[name="classification"]').selectOption("confirmed");                        // 11
    await page.locator('input[name="resolution_note"]').fill("Invoice issued on 05/04/2026; omitted from the April GSTR-1.");
    await page.getByRole("button", { name: "Draft observation from this exception" }).click();
    await page.waitForURL(/\/observations\/[0-9a-f-]{36}/);
    const obsUrl = new URL(page.url()).pathname;
    await expect(page.getByText(/Indicative impact:/)).toBeVisible();                                    // 12
    const impact = await page.locator("text=Indicative impact:").locator("..").textContent();
    expect(impact).toMatch(/₹[\d,]+/);
    await expect(page.getByText(/Snapshot [0-9a-f]{8}/)).toBeVisible();

    await page.locator('textarea[name="legal_framework"]').fill("• Section 37(1) of the CGST Act, 2017 read with Rule 59 — details of outward supplies to be furnished in GSTR-1.\n• Section 37(3) — rectification up to 30 November following the end of the financial year.");
    await page.locator('textarea[name="root_cause"]').fill("No monthly reconciliation of the sales register with GSTR-1 before filing.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^Saved/)).toBeVisible();
    await page.locator('input[name="description"]').fill("Copy of tax invoice HDM/2627/0004");                 // 13 evidence
    await page.locator('input[type="file"][name="file"]').setInputFiles({ name: "invoice-HDM-2627-0004.txt", mimeType: "text/plain", buffer: Buffer.from("Tax invoice HDM/2627/0004 dated 05/04/2026") });
    await page.getByRole("button", { name: "Add evidence" }).click();
    await expect(page.getByText("Evidence added.")).toBeVisible();
    await page.locator('input[name="title"]').last().fill("Report the invoice in the next GSTR-1 and discharge tax with interest");   // 13 corrective action
    await page.locator('select[name="compliance_step"]').selectOption("GSTR-1 amendment (Table 9A)");
    await page.locator('input[name="due_date"]').fill("2026-11-11");
    await page.getByRole("button", { name: "Add action" }).click();
    await expect(page.getByText("Corrective action added.")).toBeVisible();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("Observation moved to pending review.")).toBeVisible();
    test.info().annotations.push({ type: "observation", description: obsUrl });
  });

  test("14–15: manager reviews and approves; dashboard reflects it", async ({ page }) => {
    await login(page, USERS.manager.email, PW);
    await page.goto(`${engagementUrl}/review`);
    await page.getByRole("link", { name: /Outward supply recorded in the books/ }).first().click();
    await page.getByRole("button", { name: "Approve" }).click();                                         // 14
    await expect(page.getByText("Observation moved to approved.")).toBeVisible();
    await page.goto("/dashboard");                                                                        // 15
    const exposure = page.locator("a", { hasText: "Quantified tax exposure" });
    await expect(exposure).toBeVisible();
    await expect(exposure).not.toContainText("₹0");
  });

  test("16–18: report generation, approval and download of PDF and Excel annexures", async ({ page, request }) => {
    await login(page, USERS.manager.email, PW);
    await page.goto(`${engagementUrl}/reports`);
    await page.locator('input[name="revision_note"]').fill("Draft for management discussion");
    await page.getByRole("button", { name: "Create new draft version" }).click();                        // 16
    await expect(page.getByRole("link", { name: "PDF report" })).toBeVisible({ timeout: 180_000 });
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByText("pending approval").first()).toBeVisible();

    await login(page, ADMIN.email, ADMIN.password);
    await page.goto(`${engagementUrl}/reports`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Approve & sign (FINAL)" }).click();
    await expect(page.getByText("Approved and signed")).toBeVisible({ timeout: 180_000 });
    await page.reload();
    const pdfHref = await page.getByRole("link", { name: "PDF report" }).first().getAttribute("href");
    const xlsxHref = await page.getByRole("link", { name: "Excel annexures" }).first().getAttribute("href");
    const cookies = await page.context().cookies();
    const headers = { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
    const pdf = await request.get(pdfHref!, { headers });                                                 // 18
    expect(pdf.status()).toBe(200);
    const pdfBody = await pdf.body();
    expect(pdfBody.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfBody.length).toBeGreaterThan(40_000);
    const xlsx = await request.get(xlsxHref!, { headers });
    expect(xlsx.status()).toBe(200);
    const wb = new ExcelJS.Workbook();                                                                     // 17
    await wb.xlsx.load((await xlsx.body()) as unknown as ArrayBuffer);
    const a3 = wb.getWorksheet("A3 Exceptions")!;
    const cells: string[] = [];
    a3.eachRow((r) => r.eachCell((c) => cells.push(String(c.value ?? ""))));
    expect(cells).toContain("HDM/2627/0004");
    expect(cells.some((c) => /01_sales_register_MH\.xlsx v1 r\d+/.test(c))).toBe(true);
    const a10 = wb.getWorksheet("A10 Tax & interest")!;
    expect(a10.rowCount).toBeGreaterThan(4);
    test.info().annotations.push({ type: "files", description: `${pdfHref} ${xlsxHref}` });
    process.env.E2E_PDF_HREF = pdfHref!;
  });

  test("19: unauthorised users are denied", async ({ page, request }) => {
    // An auditor not assigned to the engagement
    await login(page, USERS.outsider.email, PW);
    const res = await page.goto(engagementUrl);
    expect(res?.status()).toBe(404);
    await page.goto("/clients");
    await expect(page.getByText("Helix Diagnostics")).toHaveCount(0);
    // …cannot download the report either
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto(`${engagementUrl}/reports`);
    const href = await page.getByRole("link", { name: "PDF report" }).first().getAttribute("href");
    await login(page, USERS.outsider.email, PW);
    const cookies = await page.context().cookies();
    const denied = await request.get(href!, { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
    expect(denied.status()).toBe(404);
    // anonymous
    const anon = await request.get(href!, { maxRedirects: 0 });
    expect([302, 307, 401]).toContain(anon.status());
    // auditors cannot reach administration
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/dashboard\?denied=users\.manage/);
    await expect(page.getByRole("alert").filter({ hasText: "You do not have permission" })).toBeVisible();
  });
});
