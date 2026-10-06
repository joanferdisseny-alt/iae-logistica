import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCodeAuthClient } from "@/lib/supabase/code-auth";

export type MemberRequest = { id: string; row_number: number; email: string; full_name: string; state: string; mail_status: string; last_error: string | null };
export const memberRequestColumns = "id, row_number, email, full_name, state, mail_status, last_error";
export function memberError(error: { code?: string; message: string }) {
  return error.code === "P0001" ? error.message : "No se pudo completar el alta. Comprueba supabase/upgrade-member-accounts.sql y reintenta la misma carga.";
}

// Each claim is owned by the authenticated administrator and leased in Postgres.
// Auth creates profile + volunteer in one transaction; SMTP is retriable separately.
export async function provisionMember(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.rpc("claim_member_provision", { p_id: id });
  if (error) return { error: memberError(error) };
  if (data.done) return { success: "Cuenta disponible; no se ha duplicado ni cambiado su contraseña." };
  let problem: string | null = null;
  let hasAccount = Boolean(data.profile_id);
  try {
    if (!hasAccount) {
      const result = await createAdminClient().auth.admin.createUser({
        email: data.email, email_confirm: false,
        app_metadata: { iae_provision_request: data.request_id }
      });
      if (result.error || !result.data.user) {
        problem = "No se pudo confirmar el alta en el servicio de acceso. Reintenta la misma fila; no se duplicará la cuenta.";
      } else hasAccount = true;
    }
    if (!problem && hasAccount) {
      const sent = await createCodeAuthClient().auth.signInWithOtp({ email: data.email, options: { shouldCreateUser: false } });
      if (sent.error) problem = "Cuenta creada; correo pendiente. Revisa SMTP y los límites de envío de Supabase. Espera antes de reintentar.";
    }
  } catch {
    problem = hasAccount ? "Cuenta creada; envío de correo sin confirmar. Reintenta esta fila más tarde." : "Alta sin confirmar. Reintenta la misma fila, sin crear otra carga.";
  }
  const finished = await supabase.rpc("finish_member_provision", { p_id: id, p_lease: data.token, p_sent: !problem, p_error: problem });
  if (finished.error) return { error: "Resultado sin confirmar. Recarga esta carga y espera dos minutos antes de reintentar. No vuelvas a cargar el archivo." };
  return problem ? { error: problem } : { success: "Cuenta y ficha disponibles. Código solicitado al servicio de correo." };
}
