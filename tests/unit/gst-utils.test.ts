import { describe, expect, it } from "vitest";
import { validateGstin, makeGstin, gstinCheckChar, isValidPan } from "@/lib/gst/gstin";
import { toPaise, formatINR, paiseToDecimal, taxAtRate, nearestStandardRate, impliedRate } from "@/lib/gst/money";
import { parseDate, parsePeriod, financialYear, fmtDate, addMonths } from "@/lib/gst/dates";
import { normaliseDocNo, docNoTail, validateHsn, normaliseDocType } from "@/lib/gst/documents";
import { normaliseStateCode } from "@/lib/gst/states";

describe("GSTIN validation", () => {
  it("accepts a checksum-valid GSTIN and extracts state and PAN", () => {
    const g = makeGstin("27", "AABCT1234C");
    const r = validateGstin(g);
    expect(r.valid).toBe(true);
    if (r.valid) { expect(r.stateCode).toBe("27"); expect(r.pan).toBe("AABCT1234C"); }
  });
  it("validates known public GSTIN checksum (Reliance Industries, 27AAACR5055K1Z7)", () => {
    expect(gstinCheckChar("27AAACR5055K1Z")).toBe("7");
    expect(validateGstin("27aaacr5055k1z7").valid).toBe(true);
  });
  it("rejects wrong checksum, wrong length, bad state and blanks", () => {
    expect(validateGstin("27AAACR5055K1Z8")).toMatchObject({ valid: false, reason: expect.stringContaining("checksum") });
    expect(validateGstin("27AAACR5055K1Z")).toMatchObject({ valid: false });
    expect(validateGstin("00AAACR5055K1Z7")).toMatchObject({ valid: false });
    expect(validateGstin("")).toMatchObject({ valid: false, reason: "GSTIN is blank" });
  });
  it("validates PAN", () => {
    expect(isValidPan("AABCT1234C")).toBe(true);
    expect(isValidPan("AABC1234C")).toBe(false);
  });
});

describe("money in paise", () => {
  it("parses Indian and accounting formats exactly", () => {
    expect(toPaise("88,67,690.00")).toBe(886769000);
    expect(toPaise("(7,60,412)")).toBe(-76041200);
    expect(toPaise("2,021.25")).toBe(202125);
    expect(toPaise("1234.565")).toBe(123457);
    expect(toPaise("-0.5")).toBe(-50);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise("₹ 1,00,000")).toBe(10000000);
    expect(toPaise("500-")).toBe(-50000);
    expect(() => toPaise("12a")).toThrow();
  });
  it("formats with Indian grouping", () => {
    expect(formatINR(886769000, { decimals: 0 })).toBe("88,67,690");
    expect(formatINR(85297237_00, { decimals: 0 })).toBe("8,52,97,237");
    expect(formatINR(-76041200, { decimals: 0, bracketsForNegative: true })).toBe("(7,60,412)");
    expect(formatINR(202125)).toBe("2,021.25");
    expect(paiseToDecimal(-5)).toBe("-0.05");
  });
  it("computes tax at rate with half-up rounding (Tosoh Obs. 34 figures)", () => {
    expect(taxAtRate(toPaise(23267), 18)).toBe(toPaise("4188.06"));
    expect(taxAtRate(toPaise(147256), 18)).toBe(toPaise("26506.08"));
    expect(taxAtRate(toPaise(2790619), 18)).toBe(toPaise("502311.42"));
    expect(taxAtRate(toPaise(40425), 5)).toBe(toPaise("2021.25"));
  });
  it("infers standard rates", () => {
    expect(nearestStandardRate(impliedRate(toPaise(100000), toPaise(18000))!)).toBe(18);
    expect(nearestStandardRate(17.2)).toBeNull();
  });
});

describe("dates and periods", () => {
  it("parses common formats as DD/MM by default and rejects impossible dates", () => {
    expect(parseDate("30/03/2026")).toBe("2026-03-30");
    expect(parseDate("05-04-26")).toBe("2026-04-05");
    expect(parseDate("2026-03-13")).toBe("2026-03-13");
    expect(parseDate("13-Mar-2026")).toBe("2026-03-13");
    expect(parseDate("31/06/2026")).toBeNull(); // Tosoh Obs. 7: 31.06.2026 is not a valid date
    expect(parseDate("31.06.2026")).toBeNull();
    expect(parseDate(46096)).toBe("2026-03-15");
  });
  it("parses return periods", () => {
    expect(parsePeriod("032026")).toBe("2026-03-01");
    expect(parsePeriod("Mar-2026")).toBe("2026-03-01");
    expect(parsePeriod("2026-04")).toBe("2026-04-01");
    expect(parsePeriod("April 2026")).toBe("2026-04-01");
  });
  it("derives financial years and formats", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
    expect(fmtDate("2026-11-30")).toBe("30/11/2026");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("document normalisation", () => {
  it("normalises separators and leading zeros", () => {
    expect(normaliseDocNo("INV/001/25-26")).toBe(normaliseDocNo("inv-1/25-26"));
    expect(normaliseDocNo("T/MRN/2526/16741")).toBe("TMRN252616741");
    expect(docNoTail("SER/2627/00632")).toBe("632");
  });
  it("validates HSN/SAC and doc types", () => {
    expect(validateHsn("38221990").ok).toBe(true);
    expect(validateHsn("3002411").ok).toBe(false);
    expect(validateHsn("998313").isService).toBe(true);
    expect(normaliseDocType("Credit Note")).toBe("CRN");
    expect(normaliseDocType("Tax Invoice")).toBe("INV");
  });
  it("normalises state codes", () => {
    expect(normaliseStateCode("27-Maharashtra")).toBe("27");
    expect(normaliseStateCode("West Bengal")).toBe("19");
    expect(normaliseStateCode("MH")).toBe("27");
    expect(normaliseStateCode("7")).toBe("07");
  });
});
