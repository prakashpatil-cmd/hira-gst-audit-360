import type { Metadata } from "next";
import "./globals.css";

// Every page depends on the signed-in user and live audit data; never pre-render at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "HIRA GST Audit 360°", template: "%s · HIRA GST Audit 360°" },
  description: "Every Transaction Verified. Every GST Risk Identified.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
