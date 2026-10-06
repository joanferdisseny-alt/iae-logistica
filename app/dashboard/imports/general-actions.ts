"use server";

import { requireAccess } from "@/lib/auth/context";
import { readInventoryFile, mapInventoryImport } from "@/lib/inventory/import";
import type { ImportPlan, ImportTable } from "@/lib/inventory/import-model";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export type FileState = { error?: string; table?: ImportTable; filename?: string };
export type ReviewState = { error?: string; draftId?: string; plan?: ImportPlan };
const databaseError = (error: { code?: string; message: string }, confirming = false) => {
  if (error.code === "P0001") return error.message;
  if (error.code === "PGRST202" || error.code === "42P01") return "Falta actualizar la base de datos. Ejecuta supabase/upgrade-inventory-import.sql en Supabase antes de importar.";
  console.error("Inventory import failed", error.code, error.message);
  if (confirming) return "No se ha podido confirmar la respuesta. Reintenta esta misma carga para comprobarla sin duplicar stock. Si persiste, contacta con un administrador.";
  return "La carga no cumple las reglas del inventario o no se ha podido validar. Revisa campos obligatorios, opciones, lotes y números de serie. No se ha guardado stock.";
};
export async function readGeneralImport(_previous: FileState, data: FormData): Promise<FileState> {
  const { isAdmin } = await requireAccess();
  if (!isAdmin) return { error: "Solo administradores pueden importar." };
  const file = data.get("file");
  if (!(file instanceof File) || !file.size || file.size > 1_000_000) return { error: "Selecciona un CSV o Excel de hasta 1 MB." };
  try { return { table: await readInventoryFile(Buffer.from(await file.arrayBuffer()), file.name), filename: file.name.slice(0, 200) }; }
  catch (error) { return { error: error instanceof z.ZodError ? "Revisa las cabeceras y el tamaño: máximo 500 filas, 40 columnas y 2.000 caracteres por celda." : error instanceof Error ? error.message : "No se ha podido leer el archivo." }; }
}
export async function reviewGeneralImport(_previous: ReviewState, data: FormData): Promise<ReviewState> {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) return { error: "Solo administradores pueden importar." };
  const parsed = z.object({ site: z.string().uuid(), destination: z.enum(["none", "location", "container"]), id: z.string().uuid().or(z.literal("")), reference: z.string().trim().min(3).max(80), filename: z.string().min(1).max(200) }).safeParse({
    site: data.get("site"), destination: data.get("destination"), id: data.get("destinationId") || "", reference: data.get("reference"), filename: data.get("filename")
  });
  if (!parsed.success || (parsed.data.destination !== "none" && !parsed.data.id)) return { error: "Selecciona la sede, el destino y una referencia de carga de 3 a 80 caracteres." };
  let payload;
  try { payload = mapInventoryImport(JSON.parse(String(data.get("table"))), JSON.parse(String(data.get("mapping")))); }
  catch (error) { return { error: error instanceof z.ZodError ? "El archivo o la asignación de columnas no son válidos." : error instanceof Error ? error.message : "Revisa las columnas." }; }
  const p = parsed.data;
  const { data: preview, error } = await supabase.rpc("preview_inventory_import", { p_payload: payload, p_site: p.site, p_location: p.destination === "location" ? p.id : null, p_container: p.destination === "container" ? p.id : null, p_reference: p.reference, p_filename: p.filename });
  if (error) return { error: databaseError(error) };
  if (!preview?.draftId || !preview?.plan) return { error: "No se ha recibido una vista previa válida. No se ha importado stock." };
  return preview as ReviewState;
}
export async function confirmGeneralImport(_previous: { error?: string; success?: boolean }, data: FormData) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) return { error: "Solo administradores pueden importar." };
  const id = z.string().uuid().safeParse(data.get("draftId"));
  if (!id.success || data.get("confirmed") !== "on") return { error: "Confirma que las cantidades son entradas que deben sumarse al stock." };
  const { error } = await supabase.rpc("confirm_inventory_import", { p_draft: id.data });
  if (error) return { error: databaseError(error, true) };
  for (const path of ["/dashboard", "/dashboard/inventory", "/dashboard/templates", "/dashboard/templates/categories", "/dashboard/templates/fields", "/dashboard/locations", "/dashboard/imports"]) revalidatePath(path);
  return { success: true };
}
