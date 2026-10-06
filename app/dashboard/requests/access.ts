import { requirePersonalAccess } from "@/lib/auth/context";

export async function requireRequestAccess() {
  const access = await requirePersonalAccess();
  const { data, error } = await access.supabase.from("profiles")
    .select("is_logistics_contact").eq("id", access.user.id)
    .maybeSingle<{ is_logistics_contact: boolean }>();
  if (error || !data) throw new Error("No se pueden verificar los permisos de solicitudes.");
  return { ...access, isLogisticsContact: access.roleCode !== "volunteer" && data.is_logistics_contact };
}
