import type { Metadata } from "next";
import "./globals.css";

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
