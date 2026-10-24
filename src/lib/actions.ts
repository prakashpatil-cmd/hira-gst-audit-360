import "server-only";
import { z } from "zod";
import type { ActionState } from "@/components/app/action-form";
import { ForbiddenError } from "@/lib/auth/session";

/** Wraps a server action body: validation errors and database errors become user-facing messages. */
export async function run(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    const r = await fn();
    return r ?? { ok: true };
  } catch (e) {
    if (isRedirect(e)) throw e;
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    if (e instanceof ForbiddenError) return { error: e.message };
    const msg = e instanceof Error ? e.message : String(e);
    if (/row-level security/i.test(msg)) return { error: "You do not have permission to perform this action." };
    if (/duplicate key/i.test(msg)) return { error: "A record with these details already exists." };
    if (/violates foreign key/i.test(msg)) return { error: "This record is referenced elsewhere and cannot be changed this way." };
    console.error("[action]", msg);
    return { error: msg.length < 300 ? msg : "The action failed. Please try again." };
  }
}

function isRedirect(e: unknown) {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

/** FormData → plain object (checkbox "on" → true; repeated keys → arrays when the key ends with []). */
export function formObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k.endsWith("[]")) { const key = k.slice(0, -2); (o[key] = (o[key] as unknown[] | undefined) ?? []); (o[key] as unknown[]).push(v); }
    else o[k] = v === "on" ? true : v;
  }
  return o;
}

export const zOptStr = z.preprocess((v) => (v === "" || v == null ? null : String(v).trim()), z.string().nullable());
export const zOptDate = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
export const zBool = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());
export const zMoney = z.preprocess((v) => (v === "" || v == null ? "0" : String(v).replace(/[,₹\s]/g, "")), z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Invalid amount"));
