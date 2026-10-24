/**
 * Idempotent base seed: firm, settings, Super Administrator, calculation rules, control library,
 * legal references and observation templates.
 *
 *   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run db:seed
 *
 * Seeded legal references and calculation rules are marked "pending approval" — a Super
 * Administrator must review and approve them in Settings → Rule Engine / Legal Library.
 */
import { config } from "dotenv";
config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { serviceSql } from "@/lib/db";
import { provisionUser } from "@/lib/auth/admin";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const RULES = [
  { code: "INT-S50-1", title: "Interest on delayed payment of tax", module: "O", method: "interestS50", params: { rate_pa: 18 }, basis: ["CGST-ACT-S50-1"], from: "2017-07-01" },
  { code: "INT-S50-3", title: "Interest on ITC wrongly availed and utilised", module: "O", method: "interestS50", params: { rate_pa: 18 }, basis: ["CGST-ACT-S50-3", "CGST-RULE-88B"], from: "2017-07-01" },
  { code: "GSTR3B-DUE", title: "GSTR-3B due date (monthly filers)", module: "O", method: "gstr3bDueDate", params: { due_day: 20 }, basis: ["CGST-ACT-S39"], from: "2017-07-01" },
  { code: "LIM-YE-CUTOFF", title: "Year-end cut-off for ITC, credit notes and rectification (30 November)", module: "O", method: "yearEndCutoff", params: { month: 11, day: 30, from_fy_start: 2021 }, basis: ["CGST-ACT-S16-4", "CGST-ACT-S34-2", "CGST-ACT-S37-3"], from: "2022-10-01" },
  { code: "LIM-S73", title: "Limitation — Section 73 (non-fraud) up to FY 2023-24", module: "O", method: "demandLimitation", params: { years: 3, scn_months_before: 3, to_fy_start: 2023 }, basis: ["CGST-ACT-S73"], from: "2017-07-01" },
  { code: "LIM-S74", title: "Limitation — Section 74 (fraud/suppression) up to FY 2023-24", module: "O", method: "demandLimitation", params: { years: 5, scn_months_before: 6, to_fy_start: 2023 }, basis: ["CGST-ACT-S74"], from: "2017-07-01" },
  { code: "LIM-S74A", title: "Limitation — Section 74A from FY 2024-25", module: "O", method: "demandLimitation", params: { s74a_from_fy_start: 2024, s74a_scn_months: 42, order_months: 12 }, basis: ["CGST-ACT-S74A"], from: "2024-11-01" },
  { code: "PEN-S73", title: "Potential penalty — non-fraud cases", module: "O", method: "potentialPenalty", params: { non_fraud_pct: 10, min_penalty_rupees: 10000 }, basis: ["CGST-ACT-S73", "CGST-ACT-S74A"], from: "2017-07-01" },
  { code: "PEN-S74", title: "Potential penalty — fraud/suppression cases", module: "O", method: "potentialPenalty", params: { pct: 100 }, basis: ["CGST-ACT-S74", "CGST-ACT-S74A"], from: "2017-07-01" },
  { code: "APL-S107", title: "First appeal — time limit and pre-deposit", module: "P", method: "appealTerms", params: { months: 3, pre_deposit_pct: 10 }, basis: ["CGST-ACT-S107"], from: "2017-07-01" },
  { code: "APL-S112", title: "Appeal to GSTAT — time limit and pre-deposit", module: "P", method: "appealTerms", params: { months: 3, pre_deposit_pct: 10 }, basis: ["CGST-ACT-S112"], from: "2024-08-01" },
  { code: "EWB-THRESHOLD", title: "E-way bill consignment value threshold", module: "G", method: "threshold", params: { rupees: 50000 }, basis: ["CGST-RULE-138"], from: "2018-04-01" },
  { code: "S18-6-R44-6", title: "Tax on disposal of capital goods", module: "L", method: "capitalGoodsDisposalTax", params: { pct_per_quarter: 5 }, basis: ["CGST-ACT-S18-6", "CGST-RULE-44-6"], from: "2017-07-01" },
];

async function main() {
  const sql = serviceSql();
  const [org] = await sql<{ id: string }[]>`insert into public.organisations (name, slug) values ('HIRA Associates', 'hira')
    on conflict (slug) do update set name = excluded.name returning id`;
  await sql`insert into public.system_settings (organisation_id, brand, report, security, ai)
    values (${org.id}, ${sql.json(DEFAULT_SETTINGS.brand as never)}, ${sql.json(DEFAULT_SETTINGS.report as never)},
            ${sql.json(DEFAULT_SETTINGS.security as never)}, ${sql.json(DEFAULT_SETTINGS.ai as never)})
    on conflict (organisation_id) do nothing`;

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@hiraassociates.in";
  const [exists] = await sql`select 1 from public.users where lower(email) = lower(${email})`;
  if (!exists) {
    const password = process.env.SEED_ADMIN_PASSWORD ?? `Hira-${randomBytes(6).toString("base64url")}9!`;
    const id = await provisionUser({ email, fullName: process.env.SEED_ADMIN_NAME ?? "Prakash Patil", password, designation: "GST Consultant", sql });
    await sql`insert into public.memberships (organisation_id, user_id, role_code) values (${org.id}, ${id}, 'super_admin') on conflict do nothing`;
    console.log(`Super Administrator created: ${email}${process.env.SEED_ADMIN_PASSWORD ? "" : `  temporary password: ${password}  (change it after first login)`}`);
  }

  for (const r of RULES) {
    await sql`insert into public.rule_definitions (rule_code, version, module, title, effective_from, legal_basis, calc_method, params, status, change_note)
      values (${r.code}, 1, ${r.module}, ${r.title}, ${r.from}, ${r.basis}, ${r.method}, ${sql.json(r.params)}, 'pending_approval',
              'Seeded default — requires Super Administrator review and approval')
      on conflict (rule_code, version) do nothing`;
  }

  const legalPath = "db/seed/legal_references.json";
  if (fs.existsSync(legalPath)) {
    const refs = JSON.parse(fs.readFileSync(legalPath, "utf8")) as Record<string, unknown>[];
    for (const l of refs) {
      await sql`insert into public.legal_references (code, source_type, title, provision, statute, jurisdiction, source_url, notification_no,
          publication_date, effective_from, summary, legal_status, verification_status, approval_status)
        values (${l.code as string}, ${l.source_type as string}, ${l.title as string}, ${(l.provision ?? null) as string}, ${(l.statute ?? null) as string},
          ${(l.jurisdiction ?? "central") as string}, ${(l.source_url ?? null) as string}, ${(l.notification_no ?? null) as string},
          ${(l.publication_date ?? null) as string}, ${(l.effective_from ?? null) as string}, ${(l.summary ?? null) as string},
          ${(l.legal_status ?? "effective") as string}, 'unverified', 'pending')
        on conflict (code) do nothing`;
    }
    console.log(`Legal references: ${refs.length}`);
  }

  const ctrlPath = "db/seed/controls.json";
  if (fs.existsSync(ctrlPath)) {
    const controls = JSON.parse(fs.readFileSync(ctrlPath, "utf8")) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const c of controls) {
      await sql`insert into public.audit_controls (id, module, category, title) values (${c.id}, ${c.module}, ${c.category}, ${c.title})
        on conflict (id) do update set category = excluded.category, title = excluded.title`;
      await sql`insert into public.control_versions (control_id, version, effective_from, taxpayer_classes, objective, law_refs, required_data, procedure,
          automation, expected_result, exception_conditions, risk_level, exposure_basis, evidence_required, corrective_action, status)
        values (${c.id}, 1, ${c.effective_from ?? "2017-07-01"}, ${c.taxpayer_classes ?? []}, ${c.objective}, ${c.law_refs ?? []}, ${c.required_data ?? []},
          ${c.procedure}, ${c.automation ? sql.json(c.automation) : null}, ${c.expected_result}, ${c.exception_conditions}, ${c.risk_level},
          ${c.exposure_basis ?? null}, ${c.evidence_required ?? []}, ${c.corrective_action}, 'approved')
        on conflict (control_id, version) do nothing`;
    }
    console.log(`Controls: ${controls.length}`);
  }

  const tplPath = "db/seed/observation_templates.json";
  if (fs.existsSync(tplPath)) {
    const tpls = JSON.parse(fs.readFileSync(tplPath, "utf8")) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from public.observation_templates where organisation_id = ${org.id}`;
    if (n === 0) for (const t of tpls) {
      await sql`insert into public.observation_templates (organisation_id, module, control_id, category, title, observation_text, legal_framework,
          legal_reference_codes, action_required, preventive_control, risk_grade, impact_bucket, industries, tags, is_approved)
        values (${org.id}, ${t.module ?? null}, ${t.control_id ?? null}, ${t.category}, ${t.title}, ${t.observation_text}, ${t.legal_framework},
          ${t.legal_reference_codes ?? []}, ${t.action_required}, ${t.preventive_control ?? ""}, ${t.risk_grade}, ${t.impact_bucket ?? null},
          ${t.industries ?? []}, ${t.tags ?? []}, true)`;
    }
    console.log(`Observation templates: ${tpls.length}`);
  }
  console.log("Seed complete.");
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
