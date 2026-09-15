"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/context";
import { checklistError, createChecklistSchema, saveLineSchema, closeChecklistSchema, type ChecklistState } from "./model";

export async function createChecklist(_previous: ChecklistState, form: FormData): Promise<ChecklistState> {
  const { supabase } = await requireAccess();
  const parsed = createChecklistSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisa la caja, el nombre de actividad (3-160 caracteres), la fecha y el equipo." };
  const v = parsed.data;
  const { data, error } = await supabase.rpc("create_container_checklist", {
    p_id: v.id, p_container_id: v.containerId, p_event_type: v.eventType,
    p_event_name: v.eventName, p_event_date: v.eventDate, p_team_name: v.teamName
  });
  if (error || !data) return { error: checklistError(error) };
  revalidatePath("/dashboard/checklists");
  redirect(`/dashboard/checklists/${data}`);
}

export async function saveChecklistLine(_previous: ChecklistState, form: FormData): Promise<ChecklistState> {
  const { supabase } = await requireAccess();
  const result = form.get("intent") === "ok" ? "ok" : form.get("result");
  const parsed = saveLineSchema.safeParse({
    lineId: form.get("lineId"), revision: form.get("revision"), result,
    quantity: result === "ok" || result === "pending" ? null : form.get("quantity"),
    notes: result === "ok" || result === "pending" ? "" : form.get("notes") ?? ""
  });
  if (!parsed.success) return { error: "Revisa el resultado, la cantidad (hasta 3 decimales) y la nota de incidencia." };
  const v = parsed.data;
  const { error } = await supabase.rpc("save_checklist_item", {
    p_line_id: v.lineId, p_revision: v.revision, p_result: v.result, p_quantity: v.quantity, p_notes: v.notes
  });
  if (error) return { error: checklistError(error) };
  revalidatePath("/dashboard/checklists", "layout");
  return { success: "Comprobación guardada." };
}

export async function closeChecklist(_previous: ChecklistState, form: FormData): Promise<ChecklistState> {
  const { supabase } = await requireAccess();
  const parsed = closeChecklistSchema.safeParse({
    id: form.get("id"), boxReturned: form.get("boxReturned") === "on",
    summary: form.get("summary") ?? "", cancel: form.get("intent") === "cancel"
  });
  if (!parsed.success) return { error: "Añade un motivo si cancelas o si la caja no vuelve a su ubicación (3-2000 caracteres)." };
  const v = parsed.data;
  const { error } = await supabase.rpc("close_container_checklist", {
    p_id: v.id, p_box_returned: v.boxReturned, p_summary: v.summary, p_cancel: v.cancel
  });
  if (error) return { error: checklistError(error) };
  revalidatePath("/dashboard/checklists", "layout");
  revalidatePath("/dashboard/locations", "layout");
  return { success: "Revisión cerrada. El resultado queda guardado en el historial." };
}
