import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      outline: "text-foreground",
      critical: "border-transparent bg-red-900 text-white",
      high: "border-transparent bg-red-100 text-red-800",
      medium: "border-transparent bg-amber-100 text-amber-800",
      low: "border-transparent bg-hira-100 text-hira-800",
      opportunity: "border-transparent bg-blue-100 text-blue-800",
      muted: "border-transparent bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const RISK_LABEL: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", opportunity: "Opportunity" };
export function RiskBadge({ risk }: { risk: string | null | undefined }) {
  if (!risk) return <Badge variant="muted">—</Badge>;
  return <Badge variant={(risk in RISK_LABEL ? risk : "muted") as "high"}>{RISK_LABEL[risk] ?? risk}</Badge>;
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "";
  const tone = /^(approved|committed|completed|passed|resolved|closed|final|verified|issued|accepted|clean|matched|confirmed_observation)$/.test(s) ? "secondary"
    : /^(failed|rejected|infected|exception_detected|changes_requested|overdue)$/.test(s) ? "high"
    : /^(pending|pending_review|pending_approval|validating|committing|running|queued|under_investigation|pending_client|data_awaited|in_progress|submitted)$/.test(s) ? "medium"
    : "muted";
  return <Badge variant={tone as "secondary"}>{s.replace(/_/g, " ") || "—"}</Badge>;
}
