import "server-only";
import type { Tx } from "@/lib/db";

/** Records an application-level event (exports, downloads, approvals) in the append-only audit log. */
export async function logAction(tx: Tx, e: { organisationId: string; actorId: string; action: string; entityType: string;
  entityId?: string | null; engagementId?: string | null; context?: Record<string, unknown> }) {
  await tx`insert into public.audit_logs (organisation_id, engagement_id, actor_id, action, entity_type, entity_id, context)
    values (${e.organisationId}, ${e.engagementId ?? null}, ${e.actorId}, ${e.action}, ${e.entityType}, ${e.entityId ?? null},
            ${tx.json((e.context ?? {}) as never)})`;
}
