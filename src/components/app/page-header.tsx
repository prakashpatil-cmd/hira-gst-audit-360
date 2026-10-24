import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function PageHeader({ title, description, actions, crumbs }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; crumbs?: { href?: string; label: string }[];
}) {
  return (
    <div className="mb-6 space-y-2">
      {crumbs?.length ? (
        <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3 w-3" /> : null}
              {c.href ? <Link href={c.href} className="hover:text-foreground hover:underline">{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-hira-800">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: "danger" | "good" | "info" }) {
  const body = (
    <div className={`rounded-lg border bg-card p-4 shadow-sm transition-colors ${href ? "hover:border-primary/60 hover:bg-accent/40" : ""}`}>
      <p className="field-label">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "danger" ? "text-red-700" : tone === "good" ? "text-hira-700" : tone === "info" ? "text-blue-700" : "text-foreground"}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Section({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-hira-800">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="p-0">{children}</div>
    </section>
  );
}

export function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="px-3 py-2 text-xs text-muted-foreground">{total.toLocaleString("en-IN")} record(s)</p>;
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
      <span>{total.toLocaleString("en-IN")} records · page {page} of {pages}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link className="rounded border px-2 py-1 hover:bg-muted" href={href(page - 1)}>Previous</Link> : null}
        {page < pages ? <Link className="rounded border px-2 py-1 hover:bg-muted" href={href(page + 1)}>Next</Link> : null}
      </span>
    </div>
  );
}
