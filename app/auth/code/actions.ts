"use server";

import { z } from "zod";
import { createCodeAuthClient } from "@/lib/supabase/code-auth";

const identity = z.object({ email: z.string().trim().email().max(254).transform(s => s.toLowerCase()), mode: z.enum(["activate", "recover"]) });
type State = { error?: string; success?: string } | undefined;

export async function requestAccessCode(_state: State, form: FormData) {
  const parsed = identity.safeParse({ email: form.get("email"), mode: form.get("mode") });
  if (!parsed.success) return { error: "Introduce un correo válido." };
  try {
    const client = createCodeAuthClient();
    if (parsed.data.mode === "activate") await client.auth.signInWithOtp({ email: parsed.data.email, options: { shouldCreateUser: false } });
    else await client.auth.resetPasswordForEmail(parsed.data.email);
    // Provider failures (including SMTP failures) must not disclose account existence.
    return { success: "Si el correo tiene una cuenta y el envío está disponible, recibirás un código. Revisa también spam. Espera al menos un minuto antes de solicitar otro; utiliza solo el último código recibido." };
  } catch { return { error: "No se pudo contactar con el servicio de acceso. Inténtalo más tarde." }; }
}

export async function setPasswordWithCode(_state: State, form: FormData) {
  const parsed = identity.extend({
    code: z.string().trim().regex(/^\d{6,10}$/),
    password: z.string().min(12).max(128),
    repeat: z.string()
  }).refine(v => v.password === v.repeat).safeParse({
    email: form.get("email"), mode: form.get("mode"), code: form.get("code"), password: form.get("password"), repeat: form.get("repeat")
  });
  if (!parsed.success) return { error: "Revisa el correo y el código. Las contraseñas deben coincidir y tener entre 12 y 128 caracteres." };
  const { email, code, password, mode } = parsed.data;
  let client: ReturnType<typeof createCodeAuthClient> | undefined;
  let verified = false;
  try {
    client = createCodeAuthClient();
    const { data, error } = await client.auth.verifyOtp({ email, token: code, type: mode === "recover" ? "recovery" : "email" });
    if (error || !data.session) return { error: "Código incorrecto, caducado o ya utilizado. Solicita uno nuevo si es necesario." };
    verified = true;
    const update = await client.auth.updateUser({ password });
    if (update.error) return { error: "El código se ha validado, pero no se pudo guardar la contraseña. Solicita otro código y prueba una contraseña distinta que cumpla la política de seguridad." };
    return { success: "Contraseña guardada. Ya puedes iniciar sesión con tu correo y contraseña." };
  } catch {
    return { error: verified ? "No se pudo confirmar el cambio. Prueba a iniciar sesión; si no funciona, solicita otro código." : "No se pudo verificar el código. Inténtalo de nuevo." };
  } finally {
    // Never expose OTP sessions to the browser; revoke refresh tokens after password changes.
    if (verified && client) await client.auth.signOut({ scope: "global" }).catch(() => undefined);
  }
}
