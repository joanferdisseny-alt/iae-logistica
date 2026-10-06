"use server";

import { requireAccess } from "@/lib/auth/context";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`); return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value;
});
const resultError = (error: { code?: string; message: string }) => error.code === "P0001" ? error.message
  : error.code === "23505" ? "El código o la cuenta de acceso ya están asociados a otro voluntario."
    : "No se pudo guardar. Comprueba supabase/upgrade-uniformity.sql y reintenta con los mismos datos.";
const uncertainError = (error: { code?: string }) => !["P0001", "23502", "23503", "23505", "23514", "42501", "22P02"].includes(error.code ?? "");

export async function searchVolunteerProfiles(query: string, site: string) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin || !uuid.safeParse(site).success || typeof query !== "string" || query.trim().length < 2 || query.length > 100) return { rows: [] };
  const { data, error } = await supabase.from("profiles").select("id, full_name")
    .eq("headquarters_id", site).eq("is_active", true).ilike("full_name", `%${query.trim().replace(/[\\%_*]/g, "\\$&")}%`)
    .order("full_name").order("id").limit(21).returns<{ id: string; full_name: string | null }[]>();
  return error ? { rows: [], error: "No se pudieron buscar las cuentas." } : { rows: data?.slice(0, 20) ?? [], hasMore: (data?.length ?? 0) > 20 };
}

export async function saveVolunteer(form: FormData) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) return { error: "Solo administradores pueden registrar voluntarios." };
  const values = z.object({ id: uuid.nullable(), code: z.string().trim().min(1).max(80), name: z.string().trim().min(2).max(160), email: z.string().trim().email().or(z.literal("")), site: uuid, profile: uuid.nullable() })
    .safeParse({ id: form.get("id") || null, code: form.get("code"), name: form.get("name"), email: form.get("email") ?? "", site: form.get("site"), profile: form.get("profileId") || null });
  if (!values.success) return { error: "Revisa código, nombre, sede y correo (opcional)." };
  const v = values.data;
  const { error } = await supabase.rpc("save_volunteer", { p_id: v.id, p_code: v.code, p_name: v.name, p_email: v.email, p_headquarters_id: v.site, p_profile_id: v.profile });
  if (error) return { error: resultError(error), uncertain: uncertainError(error) };
  revalidatePath("/dashboard/volunteers"); revalidatePath("/dashboard/personal");
  if (v.id) revalidatePath(`/dashboard/volunteers/${v.id}`);
  return { success: "Ficha de voluntario guardada. Esto no crea cuentas ni envía invitaciones." };
}

export async function findDeliveryItems(query: string, site: string) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin || !uuid.safeParse(site).success || typeof query !== "string" || query.trim().length < 2 || query.length > 100) return { rows: [] };
  const { data, error } = await supabase.from("inventory_items").select("id, name, current_stock")
    .eq("headquarters_id", site).ilike("name", `%${query.trim().replace(/[\\%_*]/g, "\\$&")}%`).order("name").order("id").limit(21)
    .returns<{ id: string; name: string; current_stock: number }[]>();
  return error ? { rows: [], error: "No se pudieron buscar los artículos." } : { rows: data?.slice(0, 20) ?? [], hasMore: (data?.length ?? 0) > 20 };
}

export async function deliveryPositions(itemId: string) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin || !uuid.safeParse(itemId).success) return { rows: [] };
  const rows: { id: string; quantity: number; label: string }[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("inventory_stock_positions")
      .select("id, quantity, locations(name), inventory_containers(name), inventory_stock_lots(code)").eq("item_id", itemId).order("id").range(from, from + 499)
      .returns<{ id: string; quantity: number; locations: { name: string } | null; inventory_containers: { name: string } | null; inventory_stock_lots: { code: string } | null }[]>();
    if (error || !data) return { rows: [], error: "No se pudieron cargar las existencias completas." };
    rows.push(...data.map(s => ({ id: s.id, quantity: s.quantity, label: `${s.inventory_containers?.name ?? s.locations?.name ?? "Sin ubicación"} · ${s.inventory_stock_lots?.code ?? "Lote"} · ${s.quantity} uds.` })));
    if (data.length < 500) return { rows };
  }
}

export async function recordDelivery(form: FormData) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) return { error: "Solo administradores pueden registrar entregas." };
  const parsed = z.object({ id: uuid, volunteer: uuid, item: uuid, quantity: z.coerce.number().int().min(1).max(1000000), mode: z.enum(["historical", "issue"]), date: date.nullable(), source: uuid.nullable(), notes: z.string().trim().max(1800), confirm: z.literal("on") })
    .safeParse({ id: form.get("requestId"), volunteer: form.get("volunteerId"), item: form.get("itemId"), quantity: form.get("quantity"), mode: form.get("mode"), date: form.get("date") || null, source: form.get("sourceId") || null, notes: form.get("notes") ?? "", confirm: form.get("confirmed") });
  if (!parsed.success || (parsed.data.mode === "issue" && (!parsed.data.source || !parsed.data.date))) return { error: "Revisa artículo, cantidad, fecha, origen y confirma el tipo de entrega." };
  const p = parsed.data;
  const { error } = await supabase.rpc("record_volunteer_delivery", { p_id: p.id, p_volunteer_id: p.volunteer, p_item_id: p.item, p_quantity: p.quantity,
    p_historical: p.mode === "historical", p_delivered_on: p.date, p_source_id: p.mode === "issue" ? p.source : null, p_notes: p.notes });
  if (error) return { error: resultError(error), uncertain: uncertainError(error) };
  revalidatePath(`/dashboard/volunteers/${p.volunteer}`); revalidatePath("/dashboard/personal"); revalidatePath("/dashboard/inventory");
  revalidatePath(`/dashboard/inventory/${p.item}`);
  return { success: p.mode === "historical" ? "Entrega histórica registrada sin descontar stock." : "Entrega registrada y descontada del origen seleccionado." };
}

export async function returnDelivery(form: FormData) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) return { error: "Solo administradores pueden registrar devoluciones." };
  const parsed = z.object({ id: uuid, delivery: uuid, quantity: z.coerce.number().int().min(1).max(1000000), destination: uuid, notes: z.string().trim().min(3).max(1800) })
    .safeParse({ id: form.get("requestId"), delivery: form.get("deliveryId"), quantity: form.get("quantity"), destination: form.get("destinationId"), notes: form.get("notes") });
  if (!parsed.success) return { error: "Revisa cantidad, destino y motivo de la devolución." };
  const p = parsed.data;
  const { error } = await supabase.rpc("return_volunteer_delivery", { p_id: p.id, p_delivery_id: p.delivery, p_quantity: p.quantity, p_destination_id: p.destination, p_notes: p.notes });
  if (error) return { error: resultError(error), uncertain: uncertainError(error) };
  revalidatePath("/dashboard/volunteers", "layout"); revalidatePath("/dashboard/personal"); revalidatePath("/dashboard/inventory", "layout");
  return { success: "Devolución registrada y existencias repuestas en el destino." };
}
