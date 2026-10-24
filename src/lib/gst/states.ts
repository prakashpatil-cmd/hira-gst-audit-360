/** GST state / UT codes (first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "96": "Foreign Country", "97": "Other Territory", "99": "Centre Jurisdiction",
};

const BY_NAME = new Map(Object.entries(GST_STATES).map(([c, n]) => [n.toLowerCase(), c]));

/** Accepts "27", "27-Maharashtra", "Maharashtra", "MH". Returns the two-digit code or null. */
export function normaliseStateCode(input: unknown): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\b/);
  if (m) {
    const c = m[1].padStart(2, "0");
    return GST_STATES[c] ? c : null;
  }
  const byName = BY_NAME.get(s.toLowerCase().replace(/\s*\(.*\)$/, ""));
  if (byName) return byName;
  return ALPHA[s.toUpperCase()] ?? null;
}

const ALPHA: Record<string, string> = {
  JK: "01", HP: "02", PB: "03", CH: "04", UK: "05", UT: "05", HR: "06", DL: "07", RJ: "08", UP: "09", BR: "10", SK: "11",
  AR: "12", NL: "13", MN: "14", MZ: "15", TR: "16", ML: "17", AS: "18", WB: "19", JH: "20", OD: "21", OR: "21", CG: "22",
  CT: "22", MP: "23", GJ: "24", DD: "26", DN: "26", MH: "27", KA: "29", GA: "30", LD: "31", KL: "32", TN: "33", PY: "34",
  AN: "35", TS: "36", TG: "36", AP: "37", LA: "38",
};
