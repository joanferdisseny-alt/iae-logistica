import { requireAccess } from "@/lib/auth/context";

export async function requireRequestAccess() {
  const access = await requireAccess();
  const { data, error } = await access.supabase.from("profiles")
    .select("is_logistics_contact").eq("id", access.user.id)
    .maybeSingle<{ is_logistics_contact: boolean }>();
  if (error || !data) throw new Error("No se pueden verificar los permisos de solicitudes.");
  return { ...access, isLogisticsContact: data.is_logistics_contact };
}
