import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import type { Tx } from "@/lib/db";

/**
 * HIRA GST Intelligence — optional drafting assistant.
 * - Off unless AI_PROVIDER=anthropic, an API key is configured AND the firm enables it in settings.
 * - Receives only facts read from the database (observation, linked exceptions, calculated amounts,
 *   legal references with their verification status). It never computes figures or invents citations;
 *   output is labelled by provenance and must be approved by a human before it enters a report.
 * - Unless the firm allows client data to be sent, names and GSTINs are replaced by placeholders.
 */
export const AI_TASKS = {
  explain: "Explain this exception or observation in plain language for the audit team.",
  verify: "Suggest additional verification steps the auditor should perform before concluding.",
  draft: "Draft section A (Observation) in the house style: facts as found, with exact document references.",
  action: "Draft section E (Action required) and F (Preventive control) as numbered, specific steps.",
  risks: "Summarise the financial and legal risks for management, using only the calculated amounts provided.",
  clarification: "Draft a polite client clarification request listing the documents and explanations needed.",
  management: "Write a short management-level explanation (5–7 sentences) suitable for the Management Summary.",
  legal: "Identify legal provisions that may be relevant. Mark every provision not in the supplied verified list as 'Legal Review Required'.",
} as const;
export type AiTask = keyof typeof AI_TASKS;

export async function aiStatus(orgId: string): Promise<{ enabled: boolean; reason?: string; allowClientData: boolean }> {
  const s = await getSettings(orgId);
  if (env().AI_PROVIDER !== "anthropic" || !env().ANTHROPIC_API_KEY) return { enabled: false, reason: "No AI provider is configured on the server.", allowClientData: false };
  if (!s.ai.enabled) return { enabled: false, reason: "AI assistance is disabled in System Settings.", allowClientData: s.ai.allowClientData };
  return { enabled: true, allowClientData: s.ai.allowClientData };
}

const SYSTEM = `You are HIRA GST Intelligence, a drafting assistant for professional Indian GST auditors at HIRA Associates.
Rules you must follow without exception:
1. Use ONLY the facts in the CASE FILE. Never invent transaction data, document numbers, dates, amounts, rates or parties.
2. Never compute new tax, interest or penalty figures. Quote amounts only from "Calculated amounts", attributing them to the calculation engine.
3. Cite legal provisions only from "Legal references". You may mention another provision only if you label it "Legal Review Required — not verified".
4. Distinguish clearly what is a verified fact, an auditor input, a calculated amount, a legal source, an assumption and an unresolved question.
5. Missing documents are documentary deficiencies, not proven tax defaults. Do not state conclusions the facts do not support.
6. Write in formal Indian professional English, using ₹ and Indian digit grouping exactly as given. Be concise.
Format your answer with these headings, omitting any that would be empty:
## Draft
## Verified facts used
## Auditor inputs used
## Calculated amounts used
## Legal sources used
## Assumptions
## Unresolved questions`;

function redactor(allow: boolean, names: string[], gstins: string[]) {
  if (allow) return (s: string) => s;
  const map = new Map<string, string>();
  names.filter(Boolean).forEach((n, i) => map.set(n, i === 0 ? "[CLIENT]" : `[PARTY-${i}]`));
  gstins.filter(Boolean).forEach((g, i) => map.set(g, `[GSTIN-${i + 1}]`));
  const keys = Array.from(map.keys()).sort((a, b) => b.length - a.length);
  return (s: string) => keys.reduce((acc, k) => acc.split(k).join(map.get(k)!), s);
}

export async function buildCaseFile(tx: Tx, observationId: string, allowClientData: boolean): Promise<string> {
  const [o] = await tx`select o.*, c.legal_name, g.gstin from public.audit_observations o join public.clients c on c.id = o.client_id
    left join public.client_gstins g on g.id = o.client_gstin_id where o.id = ${observationId}`;
  if (!o) throw new Error("Observation not found");
  const ex = await tx`select exception_type, description, doc_no, doc_date, counterparty_name, counterparty_gstin, diff_taxable, diff_tax, classification
    from public.reconciliation_exceptions where id = any(${o.source_exception_ids}::uuid[]) order by doc_date nulls last limit 40`;
  const refs = await tx`select code, provision, statute, title, summary, approval_status, verification_status from public.legal_references
    where code = any(${o.legal_reference_codes})`;
  const resp = await tx`select response_text, status from public.management_responses where observation_id = ${observationId}`;
  const red = redactor(allowClientData, [o.legal_name, ...ex.map((e) => e.counterparty_name)], [o.gstin, ...ex.map((e) => e.counterparty_gstin)]);
  const parts = [
    `CLIENT: ${o.legal_name}${o.gstin ? ` (GSTIN ${o.gstin})` : ""}`,
    `OBSERVATION ${o.obs_number}: ${o.title} | category ${o.category} | risk ${o.risk_grade} | classification ${o.classification}`,
    `AUDITOR INPUTS — current text:\nA. ${o.observation_text || "(blank)"}\nB. ${o.legal_framework || "(blank)"}\nD. ${o.root_cause || "(blank)"}\nE. ${o.action_required || "(blank)"}`,
    `CALCULATED AMOUNTS (from the deterministic engine, snapshot ${o.calc_snapshot_id ?? "none"}): tax ₹${o.tax_amount} (IGST ${o.igst}, CGST ${o.cgst}, SGST ${o.sgst}, cess ${o.cess}); interest ₹${o.interest_amount}; potential penalty ₹${o.penalty_amount}; ITC re-available ₹${o.itc_reavailable}; recoverable ₹${o.recoverable_amount}; contingent ₹${o.contingent_amount}; value affected ₹${o.affected_value ?? 0}; quantified: ${o.is_quantified ? "yes" : "no — " + (o.impact_text ?? "to be quantified")}`,
    `VERIFIED FACTS — linked exceptions (${o.source_exception_ids.length}, first ${ex.length} shown):\n${ex.map((e) => `- ${e.exception_type} | doc ${e.doc_no ?? "—"} ${e.doc_date ?? ""} | ${e.counterparty_name ?? ""} ${e.counterparty_gstin ?? ""} | taxable diff ₹${e.diff_taxable} | tax diff ₹${e.diff_tax} | ${e.description}`).join("\n") || "(none)"}`,
    `LEGAL REFERENCES (from the firm's library):\n${refs.map((r) => `- ${r.provision ?? r.code}, ${r.statute ?? ""}: ${r.title}. ${r.summary ?? ""} [${r.approval_status === "approved" ? "verified and approved" : "NOT YET VERIFIED — Legal Review Required"}]`).join("\n") || "(none supplied)"}`,
    `MANAGEMENT RESPONSES: ${resp.map((r) => `${r.status}: ${r.response_text}`).join(" | ") || "(none)"}`,
  ];
  return red(parts.join("\n\n"));
}

export async function runAiTask(caseFile: string, task: AiTask): Promise<{ text: string; model: string; refused: boolean }> {
  const client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  const response = await client.beta.messages.create({
    model: env().AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages: [{ role: "user", content: `CASE FILE\n=========\n${caseFile}\n\nTASK: ${AI_TASKS[task]}` }],
  });
  if (response.stop_reason === "refusal") {
    return { text: "The assistant declined this request. Draft this section manually.", model: response.model, refused: true };
  }
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  return { text: text || "(no text returned)", model: response.model, refused: false };
}
