"use server";

import { z } from "zod";
import { requireAccess } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getUserContact(id: string): Promise<{ email?: string; error?: string }> {
  const { isAdmin } = await requireAccess();
  if (!isAdmin || !z.string().uuid().safeParse(id).success) return { error: "No puedes consultar este usuario." };
  try {
    const { data, error } = await createAdminClient().auth.admin.getUserById(id);
    if (error || !data.user) return { error: "No se pudo cargar el correo del usuario." };
    return { email: data.user.email ?? "" };
  } catch {
    return { error: "No se pudo cargar el correo del usuario." };
  }
}
