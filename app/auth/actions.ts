"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function signInErrorMessage(error: unknown) {
  const details = error && typeof error === "object"
    ? error as { code?: unknown; name?: unknown; status?: unknown } : {};
  if (details.code === "invalid_credentials") {
    return "El correo o la contraseña no son correctos.";
  }
  if (details.status === 429) {
    return "Se han realizado demasiados intentos. Espera unos minutos antes de volver a intentarlo.";
  }
  if (details.name === "AuthRetryableFetchError" || details.status === 0 ||
      (typeof details.status === "number" && details.status >= 500)) {
    return "No se puede conectar con el servicio de acceso. No se han podido comprobar tus credenciales. Inténtalo más tarde o contacta con un administrador.";
  }
  return "No se ha podido completar el inicio de sesión. Inténtalo de nuevo o contacta con un administrador.";
}

export async function signIn(
  _previousState: { error?: string } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    return { error: "Necesitas email y contraseña." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: signInErrorMessage(error) };
  } catch {
    // Never expose credentials or provider diagnostics in the UI or application logs.
    console.error("Sign-in service unavailable before authentication completed.");
    return { error: "El servicio de acceso no está disponible. Inténtalo más tarde o contacta con un administrador." };
  }

  const safeNext = next.startsWith("/dashboard") && !next.includes("\\") &&
    (next === "/dashboard" || next.startsWith("/dashboard/") || next.startsWith("/dashboard?"))
    ? next : "/dashboard";
  redirect(safeNext);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/sign-in");
}
