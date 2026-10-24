export interface FirmSettings {
  brand: { firmName: string; tagline: string; logoPath: string; primary: string; secondary: string };
  report: {
    footerLine1: string; footerLine2: string; website: string; address: string; signatory: string; signatoryTitle: string;
    confidentiality: string; disclaimer: string; productName: string; productTagline: string;
  };
  security: { sessionIdleMinutes: number; requireMfaForAdmins: boolean; maxUploadMb: number };
  ai: { enabled: boolean; allowClientData: boolean };
}

export const DEFAULT_SETTINGS: FirmSettings = {
  brand: { firmName: "HIRA Associates", tagline: "Your GST Compliance Partner", logoPath: "/brand/hira-logo.png", primary: "#81BB41", secondary: "#878787" },
  report: {
    footerLine1: "HIRA Associates | Your GST Compliance Partner",
    footerLine2: "Adv Prakash Patil, GST Consultant | +91 98332 29199",
    website: "www.hiraassociates.in",
    address: "Airoli, Navi Mumbai",
    signatory: "Prakash Patil",
    signatoryTitle: "HIRA Associates",
    confidentiality: "This report is prepared solely for the use of the management of {{client}} and is not to be circulated, quoted or referred to, in whole or in part, without the written consent of HIRA Associates.",
    disclaimer: "This report is based on the records, vouchers, returns and portal data made available to us and on the explanations furnished by the management. Where a record was called for and not provided, the observation records that fact and the exposure has been left to be quantified. The amounts stated are indicative; each working should be confirmed by the company before the liability is discharged. Interest and penalty figures are potential amounts subject to legal conditions and professional review. This report does not constitute a certificate of compliance.",
    productName: "HIRA GST Audit 360°",
    productTagline: "Every Transaction Verified. Every GST Risk Identified.",
  },
  security: { sessionIdleMinutes: 60, requireMfaForAdmins: false, maxUploadMb: 50 },
  ai: { enabled: false, allowClientData: false },
};

