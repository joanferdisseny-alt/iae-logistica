"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/context";

export async function uploadDocument(_previous: { error?: string; success?: string } | undefined, form: FormData) {
  const { supabase, user, isAdmin } = await requireAccess();
  if (!isAdmin) return { error: "Solo administradores pueden añadir documentos." };
  const id = z.string().uuid().safeParse(form.get("itemId"));
  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  if (!id.success || !(file instanceof File) || !file.size || file.size > 4 * 1024 * 1024 || !title || title.length > 200) return { error: "Selecciona un PDF, JPG o PNG de hasta 4 MB e indica un título." };
  const { data: item, error: itemError } = await supabase.from("inventory_items").select("id").eq("id", id.data).maybeSingle();
  if (itemError || !item) return { error: "Artículo no disponible." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  if (!pdf && !jpg && !png) return { error: "El contenido del archivo no es PDF, JPG ni PNG." };
  const contentType = pdf ? "application/pdf" : jpg ? "image/jpeg" : "image/png";
  const path = `${id.data}/${crypto.randomUUID()}.${pdf ? "pdf" : jpg ? "jpg" : "png"}`;
  const { error: uploadError } = await supabase.storage.from("inventory-documents").upload(path, bytes, { contentType, upsert: false });
  if (uploadError) return { error: "No se pudo subir el documento. Comprueba la conexión y los permisos de almacenamiento." };
  const { error } = await supabase.from("inventory_attachments").insert({ item_id: id.data, title, url: null, storage_path: path, created_by: user.id });
  if (error) {
    await supabase.storage.from("inventory-documents").remove([path]);
    return { error: "No se pudo vincular el documento a la ficha." };
  }
  revalidatePath(`/dashboard/inventory/${id.data}`);
  return { success: "Documento privado añadido." };
}
