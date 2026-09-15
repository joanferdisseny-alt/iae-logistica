"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/context";
import { z } from "zod";
import { changeStatusSchema, createRequestSchema, type RequestActionState, type RequestArticle } from "./model";

export async function searchRequestArticles(query: string, headquartersId: string): Promise<{
  articles: RequestArticle[]; error?: string; hasMore?: boolean;
}> {
  const { supabase, profile, isAdmin } = await requireAccess();
  const site = isAdmin ? headquartersId : profile.headquarters_id;
  if (!z.string().uuid().safeParse(site).success || typeof query !== "string" || query.trim().length > 100) {
    return { articles: [], error: "Selecciona una sede y escribe un nombre de hasta 100 caracteres." };
  }
  const term = query.trim();
  if (term.length < 2) return { articles: [] };
  const { data, error } = await supabase.from("inventory_items")
    .select("id, name, unit, sku, current_stock").eq("headquarters_id", site)
    .ilike("name", `%${term.replace(/[\\%_*]/g, "\\$&")}%`)
    .order("name").order("id").limit(21).returns<RequestArticle[]>();
  if (error || !data) return { articles: [], error: "No se pudieron buscar los artículos. Vuelve a intentarlo." };
  return { articles: data.slice(0, 20), hasMore: data.length > 20 };
}

export async function createRequest(_previous: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const { supabase, profile, isAdmin } = await requireAccess();
  const parsed = createRequestSchema.safeParse({
    headquartersId: isAdmin ? formData.get("headquartersId") : profile.headquarters_id,
    itemId: formData.get("itemId") || null,
    material: formData.get("material"), quantity: formData.get("quantity"),
    unit: formData.get("unit"), notes: formData.get("notes") ?? ""
  });
  if (!parsed.success) return { error: "Revisa sede, material, unidad y cantidad positiva (maximo 3 decimales). Notas: maximo 2000 caracteres." };
  const values = parsed.data;
  if (values.itemId) {
    const { data: item, error } = await supabase.from("inventory_items")
      .select("id, name, unit").eq("id", values.itemId).eq("headquarters_id", values.headquartersId)
      .maybeSingle<{ id: string; name: string; unit: string | null }>();
    if (error || !item) return { error: "El artículo no está disponible en esta sede. Búscalo y selecciónalo de nuevo." };
    values.material = item.name.slice(0, 160);
    values.unit = (item.unit?.trim() || "unidades").slice(0, 40);
  }
  const { data, error } = await supabase.from("logistics_requests").insert({
    headquarters_id: values.headquartersId, material: values.material,
    item_id: values.itemId ?? null,
    quantity: values.quantity, unit: values.unit, notes: values.notes
  }).select("id").single<{ id: string }>();
  if (error?.code === "PGRST204" || error?.code === "42703") return { error: "Falta actualizar la base de datos. Un administrador debe ejecutar supabase/upgrade-2026-09-15.sql." };
  if (error || !data) return { error: "No se pudo crear la solicitud. Comprueba que tu cuenta y la sede siguen activas." };
  revalidatePath("/dashboard/requests");
  redirect(`/dashboard/requests/${data.id}`);
}

export async function changeRequestStatus(_previous: RequestActionState, formData: FormData): Promise<RequestActionState> {
  const { supabase } = await requireAccess();
  const parsed = changeStatusSchema.safeParse({
    requestId: formData.get("requestId"), expectedStatus: formData.get("expectedStatus"),
    status: formData.get("status")
  });
  if (!parsed.success) return { error: "El cambio de estado no es valido." };
  const { requestId, expectedStatus, status } = parsed.data;
  // RLS is authoritative; the old status also prevents lost concurrent updates.
  const { data, error } = await supabase.from("logistics_requests").update({ status })
    .eq("id", requestId).eq("status", expectedStatus).select("id").maybeSingle<{ id: string }>();
  if (error || !data) return { error: "No se pudo guardar: faltan permisos o la solicitud ha cambiado. Actualiza la pagina." };
  revalidatePath("/dashboard/requests");
  revalidatePath(`/dashboard/requests/${requestId}`);
  return { success: "Estado actualizado." };
}
