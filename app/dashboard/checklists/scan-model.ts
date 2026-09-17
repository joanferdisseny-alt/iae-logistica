import { z } from "zod";
import type { ChecklistLine } from "./model";

export function stockQrPath(positionId: string) {
  return `/dashboard/stock/${positionId}`;
}

export function parseStockQr(value: string, origin: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.origin !== origin || !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/dashboard\/stock\/([^/]+)\/?$/.exec(url.pathname);
    return match && z.string().uuid().safeParse(match[1]).success ? match[1].toLowerCase() : null;
  } catch { return null; }
}

export type ScanResolution = { error: string; line?: never } | { line: ChecklistLine; error?: never };

export const scannedReturnSchema = z.object({
  checklistId: z.string().uuid(), positionId: z.string().uuid(),
  revision: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(2147483647)),
  quantity: z.string().trim().transform(value => value.replace(",", "."))
    .pipe(z.string().regex(/^\d{1,11}(\.\d{1,3})?$/)).transform(Number),
  result: z.enum(["ok", "missing", "damaged", "consumed", "misplaced"]),
  notes: z.string().trim().max(2000)
}).refine(value => value.result === "ok" || value.notes.length >= 3);
