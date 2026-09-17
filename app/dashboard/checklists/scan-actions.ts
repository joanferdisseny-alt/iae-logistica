"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/context";
import { checklistError, type Checklist, type ChecklistLine, type ChecklistState } from "./model";
import { scannedReturnSchema, type ScanResolution } from "./scan-model";

async function resolve(context: Awaited<ReturnType<typeof requireAccess>>, checklistId: string, positionId: string): Promise<ScanResolution> {
  if (!z.string().uuid().safeParse(checklistId).success || !z.string().uuid().safeParse(positionId).success) return { error: "QR o checklist no válido." };
  const { supabase, user, isAdmin } = context;
  const { data: checklist, error } = await supabase.from("container_checklists").select("*").eq("id", checklistId).maybeSingle<Checklist>();
  if (error || !checklist) return { error: "No se pudo acceder al checklist. Recarga la página." };
  if (checklist.status !== "draft") return { error: "Esta revisión ya está cerrada." };
  if (!isAdmin && checklist.created_by !== user.id) {
    const permission = await supabase.rpc("can_manage_logistics_requests", { p_headquarters_id: checklist.headquarters_id });
    if (permission.error || permission.data !== true) return { error: "Solo el autor o un responsable de logística puede completar esta revisión." };
  }
  const position = await supabase.from("inventory_stock_positions").select("item_id, lot_id, container_id")
    .eq("id", positionId).maybeSingle<{ item_id: string; lot_id: string; container_id: string | null }>();
  if (position.error || !position.data) return { error: "Existencias no disponibles. La etiqueta puede ser antigua o de otra sede." };
  if (position.data.container_id !== checklist.container_id) return { error: "Este QR no pertenece a la caja que estás revisando. No se ha modificado nada." };
  const line = await supabase.from("container_checklist_items").select("*")
    .eq("checklist_id", checklist.id).eq("item_id", position.data.item_id).eq("lot_id", position.data.lot_id).maybeSingle<ChecklistLine>();
  if (line.error) return { error: "No se pudo consultar la línea. Reintenta la lectura." };
  if (!line.data) return { error: "Este lote no forma parte del contenido guardado al crear el checklist. Revísalo manualmente." };
  if (line.data.result !== "pending") return { error: "Este material ya está comprobado. No se ha contado dos veces. Para corregirlo, utiliza su línea en el checklist." };
  return { line: line.data };
}

export async function resolveChecklistScan(checklistId: string, positionId: string): Promise<ScanResolution> {
  return resolve(await requireAccess(), checklistId, positionId);
}

export async function saveScannedReturn(_previous: ChecklistState, form: FormData): Promise<ChecklistState> {
  const context = await requireAccess();
  const parsed = scannedReturnSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Indica cantidad, estado y una nota si hay incidencias. Admite hasta tres decimales." };
  const v = parsed.data;
  const resolved = await resolve(context, v.checklistId, v.positionId);
  if (resolved.error) return { error: resolved.error };
  const line = resolved.line!;
  if (line.revision !== v.revision) return { error: "La línea ha cambiado. Vuelve a escanear antes de guardar." };
  if (v.quantity > Number(line.expected_quantity)) return { error: "La cantidad supera la prevista. Registra el material adicional por separado, sin modificar este checklist." };
  if (v.result === "ok" && v.quantity !== Number(line.expected_quantity)) return { error: "La cantidad no coincide con la esperada. Selecciona una incidencia y explica la diferencia." };
  const { error } = await context.supabase.rpc("save_checklist_item", {
    p_line_id: line.id, p_revision: v.revision, p_result: v.result,
    p_quantity: v.result === "ok" ? null : v.quantity, p_notes: v.result === "ok" ? "" : v.notes
  });
  if (error) return { error: checklistError(error) };
  revalidatePath("/dashboard/checklists", "layout");
  return { success: `${line.item_name}: comprobación guardada. No se han modificado las existencias.` };
}
