import "server-only";
import { serviceSql } from "@/lib/db";

import { DEFAULT_SETTINGS, type FirmSettings } from "./settings-defaults";
export { DEFAULT_SETTINGS, type FirmSettings };

export async function getSettings(orgId: string): Promise<FirmSettings> {
  const [row] = await serviceSql()<{ brand: object; report: object; security: object; ai: object }[]>`
    select brand, report, security, ai from public.system_settings where organisation_id = ${orgId}`;
  return {
    brand: { ...DEFAULT_SETTINGS.brand, ...(row?.brand ?? {}) },
    report: { ...DEFAULT_SETTINGS.report, ...(row?.report ?? {}) },
    security: { ...DEFAULT_SETTINGS.security, ...(row?.security ?? {}) },
    ai: { ...DEFAULT_SETTINGS.ai, ...(row?.ai ?? {}) },
  };
}
