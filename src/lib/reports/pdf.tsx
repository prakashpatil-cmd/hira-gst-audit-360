/* eslint-disable jsx-a11y/alt-text */
import path from "node:path";
import React from "react";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatINR } from "@/lib/gst/money";
import { fmtDate } from "@/lib/gst/dates";
import type { ReportSnapshot, ReportObservation } from "./snapshot";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({ family: "Carlito", fonts: [
    { src: path.join(FONT_DIR, "Carlito-Regular.ttf") },
    { src: path.join(FONT_DIR, "Carlito-Bold.ttf"), fontWeight: "bold" },
    { src: path.join(FONT_DIR, "Carlito-Italic.ttf"), fontStyle: "italic" },
    { src: path.join(FONT_DIR, "Carlito-BoldItalic.ttf"), fontWeight: "bold", fontStyle: "italic" },
  ] });
  Font.registerHyphenationCallback((w) => [w]);
  fontsRegistered = true;
}

const G = { dark: "#5a8a2a", mid: "#6fa533", light: "#81bb41", pale: "#eef6e4", grey: "#6b6b6b", line: "#c9c9c9", red: "#c0392b", amber: "#c98a00", frame: "#d4763b" };
const RISK_COLOR: Record<string, string> = { critical: "#7f1d1d", high: G.red, medium: G.amber, low: G.dark, opportunity: "#1f6feb" };
const R0 = (p: number) => formatINR(p, { decimals: 0 });

const s = StyleSheet.create({
  page: { fontFamily: "Carlito", fontSize: 10, color: "#222", paddingTop: 62, paddingBottom: 70, paddingHorizontal: 50, lineHeight: 1.35 },
  frame: { position: "absolute", top: 18, left: 18, right: 18, bottom: 18, borderWidth: 1.2, borderColor: G.frame },
  frameInner: { position: "absolute", top: 21, left: 21, right: 21, bottom: 21, borderWidth: 0.4, borderColor: G.frame },
  header: { position: "absolute", top: 30, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.8, borderBottomColor: G.light, paddingBottom: 3 },
  headerL: { fontSize: 8.5, fontWeight: "bold", color: G.dark, letterSpacing: 0.6 },
  headerR: { fontSize: 8.5, color: G.grey },
  footer: { position: "absolute", bottom: 28, left: 50, right: 50, borderTopWidth: 0.5, borderTopColor: G.line, paddingTop: 4 },
  footerLeft: { fontSize: 7.5, color: G.grey, width: "78%" },
  footerFirm: { fontSize: 7.5, color: G.dark, textAlign: "center" },
  watermark: { position: "absolute", top: 230, left: 140, width: 320, opacity: 0.06 },
  draftMark: { position: "absolute", top: 380, left: 60, fontSize: 90, color: "#c0392b", opacity: 0.09, transform: "rotate(-35deg)", fontWeight: "bold" },
  clientMark: { position: "absolute", bottom: 52, left: 50, right: 50, fontSize: 6.5, color: "#9a9a9a", textAlign: "center" },
  h1: { fontSize: 16, fontWeight: "bold", color: G.dark, borderBottomWidth: 1, borderBottomColor: G.light, paddingBottom: 3, marginBottom: 8, marginTop: 4 },
  h2: { fontSize: 12, fontWeight: "bold", color: G.dark, marginTop: 10, marginBottom: 4 },
  p: { marginBottom: 6, textAlign: "justify" },
  small: { fontSize: 8.5, color: G.grey },
  italicNote: { fontSize: 8.5, color: G.grey, fontStyle: "italic", marginTop: 4 },
  table: { borderWidth: 0.6, borderColor: G.line, marginVertical: 4 },
  thRow: { flexDirection: "row", backgroundColor: G.dark },
  th: { color: "#fff", fontWeight: "bold", fontSize: 9, padding: 4, textAlign: "center" },
  tr: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: G.line },
  td: { fontSize: 9, padding: 4 },
  bandRow: { flexDirection: "row", backgroundColor: G.pale, borderTopWidth: 0.5, borderTopColor: G.line },
  totalRow: { flexDirection: "row", backgroundColor: G.dark, borderTopWidth: 0.5, borderTopColor: G.line },
  subRow: { flexDirection: "row", backgroundColor: "#f2f2f2", borderTopWidth: 0.5, borderTopColor: G.line },
  obsBox: { borderWidth: 0.8, borderColor: "#555", padding: 8, marginTop: 12, marginBottom: 6 },
  obsTitle: { fontSize: 12.5, fontWeight: "bold", color: G.mid },
  bar: { backgroundColor: G.dark, color: "#fff", fontWeight: "bold", fontSize: 9, paddingHorizontal: 4, paddingVertical: 1.5, marginTop: 7, marginBottom: 4 },
  bulletRow: { flexDirection: "row", marginBottom: 3, paddingLeft: 4 },
  bullet: { width: 12, color: G.light, fontWeight: "bold" },
  num: { width: 16, color: G.mid, fontWeight: "bold" },
  partBanner: { backgroundColor: G.dark, padding: 12, marginVertical: 10, alignItems: "center" },
  callout: { borderLeftWidth: 3, borderLeftColor: G.light, backgroundColor: "#f4f4f4", padding: 8, marginTop: 8 },
});

const cell = (w: number | string, extra: object = {}) => ({ ...s.td, width: w, ...extra });

/** Renders paragraphs; lines starting with •/- become bullets and "1." numbered items. */
function RichText({ text }: { text: string }) {
  const lines = (text || "").split(/\n/).map((l) => l.trimEnd());
  const out: React.ReactNode[] = [];
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    const b = l.match(/^\s*[•\-–▪]\s+(.*)$/);
    const n = l.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (b) out.push(<View key={i} style={s.bulletRow} wrap={false}><Text style={s.bullet}>▪</Text><Text style={{ flex: 1, textAlign: "justify" }}>{b[1]}</Text></View>);
    else if (n) out.push(<View key={i} style={s.bulletRow}><Text style={s.num}>{n[1]}.</Text><Text style={{ flex: 1, textAlign: "justify" }}>{n[2]}</Text></View>);
    else out.push(<Text key={i} style={s.p}>{l}</Text>);
  });
  return <>{out}</>;
}

function Frame({ snap, draft }: { snap: ReportSnapshot; draft: boolean }) {
  const e = snap.engagement;
  return (
    <>
      <View style={s.frame} fixed /><View style={s.frameInner} fixed />
      <Image style={s.watermark} src={path.join(process.cwd(), "public", "brand", "hira-logo-transparent.png")} fixed />
      {draft ? <Text style={s.draftMark} fixed>DRAFT</Text> : null}
      <View style={s.header} fixed>
        <Text style={s.headerL}>{snap.firm.brand.firmName.toUpperCase()}</Text>
        <Text style={s.headerR}>GST Health Check Report  |  {e.clientName}</Text>
      </View>
      <Text style={s.clientMark} fixed>Confidential — prepared exclusively for {e.clientName}. Not to be circulated without the written consent of {snap.firm.brand.firmName}.</Text>
      <View style={s.footer} fixed>
        <Text style={s.footerLeft}>GST Health Check Report  |  {e.clientName}  |  {fmtDate(e.periodFrom)} to {fmtDate(e.periodTo)}{draft ? "  |  DRAFT" : "  |  FINAL"}</Text>
        <Text style={s.footerFirm}>{snap.firm.report.footerLine1}  ·  {snap.firm.report.footerLine2}  ·  Website: {snap.firm.report.website}</Text>
      </View>
    </>
  );
}

function Table({ cols, children }: { cols: { label: string; w: number | string; align?: "left" | "right" | "center" }[]; children: React.ReactNode }) {
  return (
    <View style={s.table}>
      <View style={s.thRow} fixed>{cols.map((c, i) => <Text key={i} style={{ ...s.th, width: c.w, textAlign: c.align ?? "center" }}>{c.label}</Text>)}</View>
      {children}
    </View>
  );
}

function ImpactRows({ snap }: { snap: ReportSnapshot }) {
  const im = snap.impact;
  const W = ["10%", "55%", "18%", "17%"];
  const section = (label: string, lines: { obs: number; basis: string; amount: number }[], nature: string, neg = false, subtotal?: number, key = label) => lines.length ? (
    <React.Fragment key={key}>
      <View style={s.bandRow} wrap={false}><Text style={cell("100%", { fontWeight: "bold", color: G.dark })}>{label}</Text></View>
      {lines.map((l, i) => (
        <View key={i} style={s.tr} wrap={false}>
          <Text style={cell(W[0], { textAlign: "center", color: G.mid, fontWeight: "bold" })}>{l.obs}</Text>
          <Text style={cell(W[1])}>{l.basis}</Text>
          <Text style={cell(W[2], { textAlign: "right" })}>{neg ? `(${R0(l.amount)})` : R0(l.amount)}</Text>
          <Text style={cell(W[3], nature === "In your favour" ? { color: G.dark } : {})}>{nature}</Text>
        </View>))}
      {subtotal != null ? <View style={s.subRow} wrap={false}><Text style={cell(W[0])} /><Text style={cell(W[1], { fontWeight: "bold" })}>{`Sub-total — ${label.slice(0, 1)}`}</Text>
        <Text style={cell(W[2], { textAlign: "right", fontWeight: "bold" })}>{R0(subtotal)}</Text><Text style={cell(W[3])} /></View> : null}
    </React.Fragment>) : null;
  const total = (label: string, amount: number, nature: string) => (
    <View style={s.totalRow} wrap={false}><Text style={cell(W[0])} /><Text style={cell(W[1], { color: "#fff", fontWeight: "bold" })}>{label}</Text>
      <Text style={cell(W[2], { color: "#fff", fontWeight: "bold", textAlign: "right" })}>{R0(amount)}</Text><Text style={cell(W[3], { color: "#fff", fontWeight: "bold" })}>{nature}</Text></View>);
  return (
    <Table cols={[{ label: "Obs.", w: W[0] }, { label: "Basis of the figure", w: W[1] }, { label: "Amount (₹)", w: W[2] }, { label: "Nature", w: W[3] }]}>
      {section("A.  Input tax credit wrongly availed — to be reversed", im.A, "Cash outflow", false, im.subtotal.A)}
      {section("B.  Reverse charge and output tax not discharged", im.B, "Cash outflow", false, im.subtotal.B)}
      {section("C.  Output tax on inadmissible credit notes", im.C, "Cash outflow", false, im.subtotal.C)}
      {section("D.  Other potential statutory tax liabilities", im.D, "Cash outflow", false, im.subtotal.D)}
      {total(`TOTAL TAX PAYABLE   (${["A", "B", "C", "D"].filter((k) => im[k as "A"].length).join(" + ") || "—"})`, im.totalTaxPayable, "Payable")}
      {section("E.  Less: input tax credit re-available", im.E, "Recoverable", true)}
      {total("NET CASH OUTFLOW BEFORE INTEREST", im.netCashBeforeInterest, "Net payable")}
      {section("F.  Contingent — pending details", im.F, "Contingent", false, im.subtotal.F)}
      {section("G.  Recoverable — in the company's favour", [...im.G, ...im.H], "In your favour")}
    </Table>
  );
}

function ObservationBlock({ o }: { o: ReportObservation }) {
  return (
    <View>
      <View style={s.obsBox} wrap={false}>
        <Text style={s.obsTitle}>Observation {o.obs_number}:  <Text style={{ color: G.dark }}>{o.title}</Text></Text>
        <Text style={{ fontSize: 8.5, color: G.grey, marginTop: 2 }}>
          Category: <Text style={{ color: "#222", fontWeight: "bold" }}>{o.category}</Text>   |   Indicative impact: <Text style={{ color: "#222", fontWeight: "bold" }}>{o.impact_label}</Text>   |   Risk: <Text style={{ color: RISK_COLOR[o.risk_grade], fontWeight: "bold" }}>{o.risk_grade[0].toUpperCase() + o.risk_grade.slice(1)}</Text>
          {o.gstin ? `   |   ${o.gstin}` : ""}{o.location ? `   |   ${o.location}` : ""}
        </Text>
      </View>
      {o.is_repeat ? <Text style={{ ...s.small, marginBottom: 3 }}>Repeat observation — also reported in an earlier review.</Text> : null}
      <Text style={s.bar} minPresenceAhead={36}>A. OBSERVATION</Text><RichText text={o.observation_text} />
      <Text style={s.bar} minPresenceAhead={36}>B. LEGAL FRAMEWORK</Text><RichText text={o.legal_framework || "Legal Review Required."} />
      {o.financial_implication ? <><Text style={s.bar} minPresenceAhead={36}>C. FINANCIAL IMPLICATION</Text><RichText text={o.financial_implication} /></> : null}
      {o.root_cause ? <><Text style={s.bar} minPresenceAhead={36}>D. ROOT CAUSE</Text><RichText text={o.root_cause} /></> : null}
      <Text style={s.bar} minPresenceAhead={36}>E. ACTION REQUIRED</Text><RichText text={o.action_required} />
      {o.preventive_control ? <><Text style={s.bar} minPresenceAhead={36}>F. PREVENTIVE CONTROL</Text><RichText text={o.preventive_control} /></> : null}
      {o.responses.length ? <><Text style={s.bar} minPresenceAhead={36}>G. MANAGEMENT RESPONSE</Text>{o.responses.map((r, i) => <Text key={i} style={s.p}>{r.text}{r.by ? ` — ${r.by}, ${fmtDate(r.date)}` : ""}</Text>)}</> : null}
      {o.action_owner || o.target_date ? <><Text style={s.bar} minPresenceAhead={36}>H. ACTION OWNER AND TARGET DATE</Text><Text style={s.p}>{o.action_owner ?? "To be nominated"}{o.target_date ? `  —  by ${fmtDate(o.target_date)}` : ""}</Text></> : null}
      {o.calc ? <Text style={{ ...s.small, fontSize: 7, marginTop: 2 }}>Calculation reference {o.calc.id.slice(0, 8)} · engine {o.calc.engine} · {o.calc.hash.slice(0, 12)}</Text> : null}
    </View>
  );
}

export function ReportDocument({ snap, label, signedBy, signedAt }: { snap: ReportSnapshot; label: "DRAFT" | "FINAL"; signedBy?: string | null; signedAt?: string | null }) {
  const e = snap.engagement;
  const draft = label === "DRAFT";
  const parts = Array.from(new Set(snap.observations.map((o) => o.part_label ?? "")));
  const byPart = (p: string) => snap.observations.filter((o) => (o.part_label ?? "") === p);
  const top5 = [...snap.observations].filter((o) => o.risk_grade !== "opportunity")
    .sort((a, b) => ["critical", "high", "medium", "low"].indexOf(a.risk_grade) - ["critical", "high", "medium", "low"].indexOf(b.risk_grade) || Number(b.tax_amount) - Number(a.tax_amount)).slice(0, 5);
  const sections = [
    ["Index", "This page."],
    ["Management Summary", "Financial impact at a glance, the five items that matter most and what to do first."],
    ["Engagement Background and Scope", "What was reviewed, at which locations, on what basis and with what limitations."],
    ["Audit Methodology and Risk Grading", "How the records were tested, how to read each observation and the meaning of the risk grades."],
    ["Summary of Observations", `All ${snap.observations.length} observations in one table with category, indicative impact and risk grade.`],
    ["Detailed Audit Observations", "Each observation with the legal framework, financial implication and the action required."],
    ["Priority Action Plan", "The sequence in which the items should be taken up, with amounts and timelines."],
    ["GST Compliance Improvement Roadmap", "Monthly, quarterly and annual review controls, and audit coverage."],
    ["Closing and Disclaimer", "Basis of the report, limitations and contact for clarifications."],
  ];
  const urgentWhy = (o: ReportObservation) => o.risk_grade === "critical" ? "Immediate escalation required" : o.classification === "confirmed" ? "Confirmed from records; interest accrues until regularised" : "Exposure requires prompt verification";
  return (
    <Document title={`GST Health Check Report — ${e.clientName}`} author={snap.firm.brand.firmName} subject={`GST Health Check ${fmtDate(e.periodFrom)} to ${fmtDate(e.periodTo)}`} creator="HIRA GST Audit 360°">
      {/* Cover */}
      <Page size="A4" style={{ ...s.page, paddingTop: 50 }}>
        <View style={s.frame} fixed /><View style={s.frameInner} fixed />
        <Image style={{ ...s.watermark, top: 250 }} src={path.join(process.cwd(), "public", "brand", "hira-logo-transparent.png")} />
        {draft ? <Text style={s.draftMark}>DRAFT</Text> : null}
        <View style={{ alignItems: "center", marginTop: 20 }}>
          <Image src={path.join(process.cwd(), "public", "brand", "hira-logo.png")} style={{ width: 150 }} />
          <Text style={{ fontSize: 11, color: G.grey, fontStyle: "italic", marginTop: 6 }}>{snap.firm.brand.tagline}</Text>
          <View style={{ width: "100%", borderBottomWidth: 2, borderBottomColor: G.light, marginTop: 14 }} />
          <Text style={{ fontSize: 24, fontWeight: "bold", color: G.dark, marginTop: 40, lineHeight: 1.2 }}>GST HEALTH CHECK REPORT</Text>
          <Text style={{ fontSize: 10.5, color: G.grey, fontStyle: "italic", marginTop: 8, lineHeight: 1.2 }}>Verification-led compliance review</Text>
          <Text style={{ fontSize: 9, color: G.grey, letterSpacing: 2, marginTop: 34 }}>PREPARED FOR</Text>
          <Text style={{ fontSize: 17, fontWeight: "bold", marginTop: 6, textAlign: "center", lineHeight: 1.2 }}>{e.clientName.toUpperCase()}</Text>
          <Text style={{ fontSize: 9.5, color: G.grey, marginTop: 6, lineHeight: 1.2 }}>PAN {e.pan}  ·  Financial year {e.financialYear}</Text>
        </View>
        <View style={{ ...s.table, marginTop: 40 }}>
          {[["Review period", `${fmtDate(e.periodFrom)} to ${fmtDate(e.periodTo)}`],
            ["GSTIN(s)", e.gstins.join(", ")],
            ...(e.visits.length ? e.visits.map((v, i) => [i === 0 ? "Audit visits" : "", `${v.label} — ${fmtDate(v.from)}${v.to && v.to !== v.from ? ` to ${fmtDate(v.to)}` : ""}`]) : []),
            ...(e.locations.length ? [["Locations audited", e.locations.map((l) => l.name).join(", ")]] : []),
            ["Observations", `${snap.observations.length}${parts.filter(Boolean).length ? ` (${parts.filter(Boolean).map((p) => `${p.split("—")[0].trim()} — ${byPart(p).length}`).join("  |  ")})` : ""}`],
            ["Engagement", e.code],
            ["Prepared by", `${snap.firm.brand.firmName}, ${snap.firm.report.address}`],
            ["Report status", `${label}${signedBy ? ` — approved by ${signedBy}${signedAt ? ` on ${fmtDate(signedAt.slice(0, 10))}` : ""}` : ""}`],
          ].map(([k, v], i) => (
            <View key={i} style={i ? s.tr : { flexDirection: "row" }} wrap={false}>
              <Text style={cell("34%", { color: G.dark, fontWeight: "bold" })}>{k}</Text><Text style={cell("66%", { borderLeftWidth: 0.5, borderLeftColor: G.line })}>{v}</Text>
            </View>))}
        </View>
        <View style={{ position: "absolute", bottom: 60, left: 50, right: 50, borderTopWidth: 1, borderTopColor: G.light, paddingTop: 6, alignItems: "center" }}>
          <Text style={{ color: G.red, fontWeight: "bold", letterSpacing: 2, fontSize: 9 }}>STRICTLY CONFIDENTIAL</Text>
          <Text style={{ ...s.small, textAlign: "center", marginTop: 3 }}>{snap.firm.report.confidentiality.replace("{{client}}", e.clientName)}</Text>
          <Text style={{ fontSize: 8.5, color: G.dark, marginTop: 4 }}>{snap.firm.report.footerLine1}</Text>
          <Text style={{ fontSize: 8.5, color: G.dark }}>{snap.firm.report.footerLine2}  |  {snap.firm.report.website}</Text>
        </View>
      </Page>

      <Page size="A4" style={s.page}>
        <Frame snap={snap} draft={draft} />
        <Text style={s.h1}>1.  Index</Text>
        <Table cols={[{ label: "Sr.", w: "8%" }, { label: "Section", w: "34%" }, { label: "What it covers", w: "58%" }]}>
          {sections.map(([t, d], i) => <View key={i} style={s.tr} wrap={false}><Text style={cell("8%", { textAlign: "center", color: G.mid, fontWeight: "bold" })}>{i + 1}</Text>
            <Text style={cell("34%", { fontWeight: "bold" })}>{t}</Text><Text style={cell("58%")}>{d}</Text></View>)}
          <View style={s.tr} wrap={false}><Text style={cell("8%", { textAlign: "center", color: G.mid, fontWeight: "bold" })}>—</Text><Text style={cell("34%", { fontWeight: "bold" })}>Annexures (Excel)</Text>
            <Text style={cell("58%")}>Invoice-level exceptions, ITC mismatches, RCM, e-way bills, exports, tax and interest workings, checklist, pending documents and action tracker.</Text></View>
        </Table>

        <Text style={{ ...s.h1, marginTop: 16 }} break>2.  Management Summary</Text>
        <RichText text={snap.content.managementIntro} />
        <Text style={s.h2} minPresenceAhead={60}>Financial Impact at a Glance</Text>
        <ImpactRows snap={snap} />
        <Text style={s.italicNote}>Interest under Section 50 is payable in addition on amounts under heads A to D from the respective due dates — indicative interest to the computation date: Rs. {R0(snap.impact.interest)}. Potential penalties under Section 73, 74 or 74A, estimated at Rs. {R0(snap.impact.penalty)}, are not included in any total and are subject to legal conditions and professional review.{snap.impact.unquantified.length ? ` ${snap.impact.unquantified.length} unquantified observation(s) (Obs. ${snap.impact.unquantified.map((u) => u.obs).join(", ")}) are excluded from all totals.` : ""}</Text>
        {top5.length ? <>
          <Text style={s.h2} minPresenceAhead={60}>The Five Items That Matter Most</Text>
          <Table cols={[{ label: "Obs.", w: "9%" }, { label: "Issue", w: "47%" }, { label: "Amount (₹)", w: "19%" }, { label: "Why it is urgent", w: "25%" }]}>
            {top5.map((o) => <View key={o.id} style={s.tr} wrap={false}><Text style={cell("9%", { textAlign: "center", color: G.mid, fontWeight: "bold" })}>{o.obs_number}</Text>
              <Text style={cell("47%")}>{o.title}</Text><Text style={cell("19%", { textAlign: "right", fontWeight: "bold" })}>{o.impact_label.replace(/^Rs\. /, "")}</Text>
              <Text style={cell("25%", { fontSize: 8.5 })}>{urgentWhy(o)}</Text></View>)}
          </Table></> : null}
        {snap.content.recommendations ? <><Text style={s.h2} minPresenceAhead={60}>What We Recommend You Do First</Text><RichText text={snap.content.recommendations.split("\n").map((l, i) => /^\d+[.)]/.test(l) ? l : `${i + 1}. ${l}`).join("\n")} /></> : null}
        <View style={s.callout} wrap={false}><Text><Text style={{ fontWeight: "bold", color: G.dark }}>Bottom line:  </Text>{snap.content.bottomLine}</Text></View>

        <Text style={s.h1} break>3.  Engagement Background and Scope</Text>
        <RichText text={snap.content.background} />
        <Text style={s.h2} minPresenceAhead={60}>Registrations and locations covered</Text>
        <Table cols={[{ label: "GSTIN", w: "35%" }, { label: "Locations", w: "65%" }]}>
          {e.gstins.map((g) => <View key={g} style={s.tr} wrap={false}><Text style={cell("35%")}>{g}</Text><Text style={cell("65%")}>{e.locations.map((l) => l.name).join(", ") || "—"}</Text></View>)}
        </Table>
        <Text style={s.h1}>4.  Audit Methodology and Risk Grading</Text>
        <RichText text={snap.content.methodology} />
        <Text style={s.p}>Each observation is set out under the following fields: Observation — the fact as found, with the document, voucher or portal record it rests on; Legal Framework — the sections, rules, notifications and circulars that govern the point, cited by number so that the position can be verified independently; Financial Implication; Root Cause; Action Required — the specific steps to be taken, addressing both the transaction and the control that allowed it; Preventive Control; and, where received and approved, the Management Response.</Text>

        <Text style={s.h1} break>5.  Summary of Observations</Text>
        <Table cols={[{ label: "Sr.", w: "6%" }, { label: "Observation", w: "38%" }, { label: "Category", w: "17%" }, { label: "GSTIN / Location", w: "14%" }, { label: "Impact (Rs.)", w: "14%" }, { label: "Risk", w: "11%" }]}>
          {parts.map((p) => (
            <React.Fragment key={p || "all"}>
              {p ? <View style={{ ...s.thRow, backgroundColor: G.mid }} wrap={false}><Text style={{ ...s.th, width: "100%", textAlign: "left" }}>{p}</Text></View> : null}
              {byPart(p).map((o) => <View key={o.id} style={s.tr} wrap={false}>
                <Text style={cell("6%", { textAlign: "center", color: G.mid, fontWeight: "bold" })}>{o.obs_number}</Text><Text style={cell("38%")}>{o.title}</Text>
                <Text style={cell("17%", { fontSize: 8.5 })}>{o.category}</Text><Text style={cell("14%", { fontSize: 7.5 })}>{o.gstin ?? "Entity"}{o.location ? `\n${o.location}` : ""}</Text>
                <Text style={cell("14%", { textAlign: "right", fontSize: 8.5 })}>{o.impact_label.replace(/^Rs\. /, "")}</Text>
                <Text style={cell("11%", { textAlign: "center", color: RISK_COLOR[o.risk_grade], fontWeight: o.risk_grade === "high" || o.risk_grade === "critical" ? "bold" : "normal" })}>{o.risk_grade[0].toUpperCase() + o.risk_grade.slice(1)}</Text>
              </View>)}
            </React.Fragment>))}
        </Table>

        <Text style={s.h1} break>6.  Detailed Audit Observations</Text>
        {parts.map((p) => (
          <View key={p || "all"}>
            {p ? <View style={s.partBanner} wrap={false}><Text style={{ color: "#fff", fontSize: 15, fontWeight: "bold", letterSpacing: 1 }}>{p.toUpperCase()}</Text>
              <Text style={{ color: "#e3f1d2", fontSize: 9 }}>Observations {byPart(p).map((o) => o.obs_number).join(", ")}</Text></View> : null}
            {byPart(p).map((o) => <ObservationBlock key={o.id} o={o} />)}
          </View>))}
        {snap.observations.length === 0 ? <Text style={s.p}>No observations have been approved for reporting.</Text> : null}

        <Text style={s.h1} break>7.  Priority Action Plan</Text>
        <Text style={s.p}>The sequence below is ordered by urgency. Items with a statutory cut-off are placed first, followed by the amounts that carry interest for as long as they remain unpaid.</Text>
        <Table cols={[{ label: "Sr.", w: "7%" }, { label: "Action", w: "48%" }, { label: "Amount (Rs.)", w: "20%" }, { label: "Timeline", w: "25%" }]}>
          {snap.actions.length === 0 ? <View style={s.tr}><Text style={cell("100%")}>Corrective actions are to be agreed with management.</Text></View> :
            snap.actions.map((a) => <View key={a.priority} style={s.tr} wrap={false}><Text style={cell("7%", { textAlign: "center", color: G.mid, fontWeight: "bold" })}>{a.priority}</Text>
              <Text style={cell("48%")}>{a.title}{a.obs ? ` (Obs. ${a.obs})` : ""}</Text>
              <Text style={cell("20%", { textAlign: "right", fontWeight: "bold" })}>{a.amount ? R0(Math.round(Number(a.amount) * 100)) : a.amountLabel ?? "—"}</Text><Text style={cell("25%", { fontSize: 8.5 })}>{a.timeline}</Text></View>)}
        </Table>

        <Text style={s.h1}>8.  GST Compliance Improvement Roadmap</Text>
        {snap.content.roadmap ? <RichText text={snap.content.roadmap} /> : null}
        {snap.roadmap.map((r) => <View key={r.frequency} wrap={false}><Text style={s.h2} minPresenceAhead={60}>{r.frequency} review controls</Text>{r.controls.map((c, i) => <View key={i} style={s.bulletRow}><Text style={s.bullet}>▪</Text><Text style={{ flex: 1 }}>{c}</Text></View>)}</View>)}
        <Text style={s.h2} minPresenceAhead={60}>Audit coverage</Text>
        <Table cols={[{ label: "Measure", w: "60%", align: "left" }, { label: "Result", w: "40%" }]}>
          {[["Applicable audit controls", String(snap.coverage.applicable)], ["Audit coverage (controls adequately tested)", `${snap.coverage.coveragePct}%  (${snap.coverage.tested})`],
            ["Compliance exception rate", `${snap.coverage.exceptionRatePct}%  (${snap.coverage.failed} controls)`], ["Controls awaiting documents", String(snap.coverage.awaiting)],
            ["Evidence completeness", `${snap.coverage.evidence.pct}%  (${snap.coverage.evidence.accepted} of ${snap.coverage.evidence.required})`], ["Controls not applicable", String(snap.coverage.notApplicable)]]
            .map(([k, v]) => <View key={k} style={s.tr} wrap={false}><Text style={cell("60%")}>{k}</Text><Text style={cell("40%", { textAlign: "center" })}>{v}</Text></View>)}
        </Table>
        <Text style={s.italicNote}>{snap.coverage.conclusion} This report is not a certificate of GST compliance.</Text>

        <Text style={s.h1} break>9.  Closing and Disclaimer</Text>
        <RichText text={snap.content.closing} />
        <Text style={s.h2} minPresenceAhead={60}>Disclaimer</Text>
        <Text style={{ ...s.p, fontSize: 9 }}>{snap.firm.report.disclaimer}</Text>
        <View wrap={false} style={{ marginTop: 18 }}>
          <Text>Kind Regards,</Text>
          <Text style={{ fontSize: 13, fontWeight: "bold", color: G.dark, marginTop: 18 }}>{snap.firm.report.signatory}</Text>
          <Text style={{ fontWeight: "bold" }}>{snap.firm.report.signatoryTitle}</Text>
          <Text style={s.small}>{snap.firm.report.address}  |  {snap.firm.report.footerLine2.split("|").pop()?.trim()}  |  {snap.firm.report.website}</Text>
          <Text style={{ ...s.small, marginTop: 6 }}>{signedBy ? `Approved and issued by ${signedBy}${signedAt ? ` on ${fmtDate(signedAt.slice(0, 10))}` : ""}.` : "Draft for discussion — not approved for issue."}</Text>
        </View>
        <Text style={s.h2} minPresenceAhead={60}>Revision history</Text>
        <Table cols={[{ label: "Version", w: "15%" }, { label: "Label", w: "15%" }, { label: "Status", w: "20%" }, { label: "Date", w: "20%" }, { label: "Note", w: "30%" }]}>
          {snap.revisions.map((r) => <View key={r.version} style={s.tr} wrap={false}><Text style={cell("15%", { textAlign: "center" })}>v{r.version}</Text><Text style={cell("15%", { textAlign: "center" })}>{r.label}</Text>
            <Text style={cell("20%", { textAlign: "center" })}>{r.status}</Text><Text style={cell("20%", { textAlign: "center" })}>{r.at ? fmtDate(r.at.slice(0, 10)) : "—"}</Text><Text style={cell("30%", { fontSize: 8 })}>{r.note ?? ""}</Text></View>)}
        </Table>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(snap: ReportSnapshot, label: "DRAFT" | "FINAL", signedBy?: string | null, signedAt?: string | null): Promise<Buffer> {
  registerFonts();
  const raw = await renderToBuffer(<ReportDocument snap={snap} label={label} signedBy={signedBy} signedAt={signedAt} />);
  return stampPageNumbers(raw);
}

/** Writes "Page X of Y" on every page after layout (exact totals, independent of react-pdf's dynamic render). */
async function stampPageNumbers(pdf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (i === 0) return; // cover
    const text = `Page ${i + 1} of ${pages.length}`;
    const size = 7;
    const w = font.widthOfTextAtSize(text, size);
    p.drawText(text, { x: p.getWidth() - 50 - w, y: 47, size, font, color: rgb(0.42, 0.42, 0.42) });
  });
  doc.setProducer("HIRA GST Audit 360°");
  return Buffer.from(await doc.save());
}
