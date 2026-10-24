import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-hira-800 p-10 text-white lg:flex">
        <div className="text-sm font-semibold tracking-widest text-hira-200">HIRA ASSOCIATES</div>
        <div>
          <h1 className="text-4xl font-semibold leading-tight">HIRA GST Audit 360°</h1>
          <p className="mt-3 text-lg text-hira-100">Every Transaction Verified. Every GST Risk Identified.</p>
          <ul className="mt-8 space-y-2 text-sm text-hira-100/90">
            <li>• Evidence-based GST Health Check audits</li>
            <li>• Invoice-level reconciliation of books, returns, e-invoices and e-way bills</li>
            <li>• Reviewed observations and management-ready reports</li>
          </ul>
        </div>
        <p className="text-xs text-hira-200">Airoli, Navi Mumbai · www.hiraassociates.in · Confidential client data — authorised users only.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <Image src="/brand/hira-logo-small.png" alt="HIRA Associates" width={180} height={119} priority className="mx-auto h-auto w-40" />
          {children}
        </div>
      </div>
    </div>
  );
}
