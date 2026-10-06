"use server";

import { requireAccess } from "@/lib/auth/context";
import { readUniformityFile, type UniformityPreview } from "@/lib/uniformity/import";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export type ImportState = { error?: string; draftId?: string; filename?: string; preview?: UniformityPreview };
export async function previewUniformity(_previous: ImportState, data: FormData): Promise<ImportState> {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) return { error: "Solo administradores pueden importar." };
  const file = data.get("file");
  if (!(file instanceof File) || !file.size || file.size > 1_000_000) return { error: "Selecciona un Excel o CSV de menos de 1 MB." };
  let preview: UniformityPreview;
  try { preview = await readUniformityFile(Buffer.from(await file.arrayBuffer()), file.name); }
  catch (error) { return { error: error instanceof Error ? error.message : "No se pudo analizar el archivo." }; }
  const filename = file.name.slice(0, 200);
  const { data: draft, error } = await supabase.from("uniformity_import_drafts")
    .insert({ filename, file_hash: preview.fileHash, rows: preview.rows }).select("id").single<{ id: string }>();
  if (error || !draft) return { error: "No se pudo guardar la vista previa. Comprueba supabase/upgrade-uniformity.sql. No se ha importado stock." };
  return { draftId: draft.id, filename, preview };
}

export async function confirmUniformity(_previous: { error?: string; success?: string }, data: FormData) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) return { error: "Solo administradores pueden importar." };
  const parsed = z.object({ draft: z.string().uuid(), site: z.string().uuid(), destination: z.enum(["none", "location", "container"]), id: z.string().uuid().or(z.literal("")), confirmed: z.literal("on") })
    .safeParse({ draft: data.get("draftId"), site: data.get("site"), destination: data.get("destination"), id: data.get("destinationId") ?? "", confirmed: data.get("availableStock") });
  if (!parsed.success || (parsed.data.destination !== "none" && !parsed.data.id)) return { error: "Selecciona sede y destino, y confirma que son existencias disponibles." };
  const p = parsed.data;
  const { data: batchId, error } = await supabase.rpc("import_uniformity_stock", {
    p_draft_id: p.draft, p_headquarters_id: p.site,
    p_location_id: p.destination === "location" ? p.id : null,
    p_container_id: p.destination === "container" ? p.id : null
  });
  if (error || !batchId) return { error: error?.code === "P0001" ? error.message : "No se pudo confirmar la importación. Reintenta esta misma vista previa: no duplicará stock. Comprueba la migración si persiste." };
  for (const path of ["/dashboard/inventory", "/dashboard/templates", "/dashboard/templates/categories", "/dashboard/templates/fields", "/dashboard/imports"]) revalidatePath(path);
  return { success: "Importación registrada. Si este contenido ya se había importado en esta sede, se ha conservado la carga anterior sin duplicarla." };
}
