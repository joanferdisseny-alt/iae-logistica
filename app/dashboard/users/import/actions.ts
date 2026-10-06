"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { readInventoryFile } from "@/lib/inventory/import";
import { mapMembers } from "@/lib/members/import";
import { memberError, memberRequestColumns, provisionMember, type MemberRequest } from "@/lib/members/provision";

async function context() {
  const result = await requireAccess();
  if (!result.isAdmin) throw Error("Solo administradores pueden importar usuarios.");
  return result;
}
async function parse(form: FormData, supabase: Awaited<ReturnType<typeof context>>["supabase"]) {
  const table = JSON.parse(String(form.get("table") ?? "null"));
  const mapping = JSON.parse(String(form.get("mapping") ?? "null"));
  if (JSON.stringify(table).length > 600000) throw Error("Archivo demasiado grande.");
  const sites = await readAllRows((a, b) => supabase.from("headquarters").select("id, name").eq("is_active", true).order("id").range(a, b).returns<{ id: string; name: string }[]>());
  return { supabase, rows: mapMembers(table, mapping, String(form.get("site") ?? ""), sites) };
}
export async function readMembersFile(form: FormData) {
  await context();
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 1000000) throw Error("Selecciona un CSV o Excel de hasta 1 MB.");
    return { table: await readInventoryFile(Buffer.from(await file.arrayBuffer()), file.name) };
  } catch (error) { return { error: error instanceof Error ? error.message : "Archivo no válido." }; }
}
export async function previewMembers(form: FormData) {
  const { supabase } = await context();
  try {
    const { rows } = await parse(form, supabase);
    const { data, error } = await supabase.rpc("preview_member_accounts", { p_emails: rows.map(r => r.email) });
    if (error || !data || data.length !== rows.length) return { error: "No se pudieron comprobar todas las cuentas. Revisa la actualización de usuarios y reintenta." };
    const existing = new Set((data as { email: string; existing: boolean }[]).filter(r => r.existing).map(r => r.email));
    return { rows: rows.map(r => ({ ...r, existing: existing.has(r.email) })) };
  } catch (error) { return { error: error instanceof Error ? error.message : "No se pudo revisar la carga." }; }
}
export async function prepareMembers(form: FormData) {
  const { supabase } = await context();
  let submitted = false;
  try {
    const { rows } = await parse(form, supabase);
    const id = z.string().uuid().parse(form.get("requestId"));
    if (form.get("confirmed") !== "on") return { error: "Confirma el alta y el envío de códigos." };
    const filename = z.string().min(1).max(200).parse(form.get("filename"));
    submitted = true;
    const result = await supabase.rpc("prepare_member_accounts", { p_id: id, p_filename: filename, p_rows: rows });
    if (result.error) return { error: memberError(result.error), uncertain: !["P0001", "23505", "23514", "22P02", "42501", "PGRST202", "42P01"].includes(result.error.code) };
    return { id };
  } catch { return { error: "No se pudo preparar la carga. Revisa los datos y reintenta con el mismo archivo.", uncertain: submitted }; }
}
export async function processMember(id: string) {
  const { supabase } = await context();
  if (!z.string().uuid().safeParse(id).success) return { error: "Alta no válida." };
  const result = await provisionMember(supabase, id);
  revalidatePath("/dashboard/users"); revalidatePath("/dashboard/volunteers", "layout"); revalidatePath("/dashboard/personal");
  return result;
}
export async function memberBatch(id: string) {
  const { supabase } = await context();
  if (!z.string().uuid().safeParse(id).success) return { error: "Carga no válida." };
  const { data, error } = await supabase.from("member_provision_requests").select(memberRequestColumns).eq("batch_id", id).order("row_number").limit(500).returns<MemberRequest[]>();
  if (error || !data?.length) return { error: "No se pudo cargar el estado. Comprueba la migración y que la carga pertenece a tu cuenta." };
  return { rows: data };
}
