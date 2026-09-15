import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const requireAccess = cache(async () => {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/auth/sign-in");
  const { data: profile, error } = await supabase.from("profiles")
    .select("full_name, is_active, headquarters_id, app_roles(code, name)")
    .eq("id", user.id)
    .maybeSingle<{
      full_name: string | null;
      is_active: boolean;
      headquarters_id: string | null;
      app_roles: { code: string; name: string } | null;
    }>();
  if (error) throw new Error("No se pueden verificar los permisos. Revisa la migración de seguridad de Supabase.");
  const roleCode = profile?.app_roles?.code ?? "";
  if (!profile?.is_active || !["admin", "editor", "reader", "operator", "viewer"].includes(roleCode)) {
    redirect("/auth/sign-in?reason=inactive");
  }
  const isAdmin = roleCode === "admin";
  if (!isAdmin && !profile.headquarters_id) redirect("/auth/sign-in?reason=headquarters");
  return { supabase, user, profile, roleCode, isAdmin };
});
