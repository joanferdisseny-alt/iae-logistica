import { z } from "zod";

export const resultLabels = { pending: "Pendiente", ok: "En su sitio", missing: "Falta material", damaged: "Dañado", consumed: "Consumido", misplaced: "Fuera de sitio" };
export type CheckResult = keyof typeof resultLabels;
export const statusLabels = { draft: "En revisión", complete: "Completa", issues: "Cerrada con incidencias", cancelled: "Cancelada" };
export type ChecklistStatus = keyof typeof statusLabels;
export const eventLabels = { practice: "Práctica / entrenamiento", intervention: "Intervención real" };
export type ChecklistState = { error?: string; success?: string };
export type BoxOption = { id: string; name: string; headquarters: { name: string } | null };
export type Checklist = {
  id: string; container_id: string; headquarters_id: string; container_name: string; location_name: string;
  event_type: keyof typeof eventLabels; event_name: string; event_date: string; team_name: string;
  status: ChecklistStatus; created_by: string; created_at: string; closed_at: string | null;
  created_by_name: string; closed_by_name: string | null;
  closed_by: string | null; box_returned: boolean; summary: string;
};
export type ChecklistLine = {
  lot_id?: string | null; lot_code?: string | null; expiration_date?: string | null;
  id: string; checklist_id: string; item_id: string; item_name: string; unit: string;
  expected_quantity: number; returned_quantity: number | null; result: CheckResult; notes: string;
  checked_by: string | null; checked_at: string | null; revision: number;
  checked_by_name: string | null;
};
export const createChecklistSchema = z.object({
  id: z.string().uuid(), containerId: z.string().uuid(), eventType: z.enum(["practice", "intervention"]),
  eventName: z.string().trim().min(3).max(160), teamName: z.string().trim().max(120),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  })
});
export const saveLineSchema = z.object({
  lineId: z.string().uuid(), revision: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(2147483647)),
  result: z.enum(["pending", "ok", "missing", "damaged", "consumed", "misplaced"]),
  quantity: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).transform(Number).nullable(),
  notes: z.string().trim().max(2000)
}).refine(value => ["pending", "ok"].includes(value.result) || (value.quantity !== null && value.notes.length >= 3));
export const closeChecklistSchema = z.object({
  id: z.string().uuid(), boxReturned: z.boolean(), summary: z.string().trim().max(2000), cancel: z.boolean()
}).refine(value => (!value.cancel && value.boxReturned) || value.summary.length >= 3);

export function checklistError(error: { code?: string; message?: string } | null) {
  if (error?.code === "PGRST202" || error?.code === "42P01") return "Falta activar los checklists en Supabase: ejecuta supabase/upgrade-checklists-2026-09-15.sql.";
  if (error?.code === "P0001" || error?.code === "40001") return error.message || "No se pudo guardar la revisión.";
  if (error?.code === "23505") return "La caja ya tiene una revisión abierta. Consulta la lista de checklists.";
  return "No se pudo guardar. Revisa la conexión y actualiza la página antes de reintentar.";
}

export function todayInSpain() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function checklistProgress(lines: Pick<ChecklistLine, "result">[]) {
  return { total: lines.length, checked: lines.filter(line => line.result !== "pending").length,
    issues: lines.filter(line => !["pending", "ok"].includes(line.result)).length };
}
