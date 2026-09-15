"use client";

import { useActionState } from "react";
import { signIn } from "@/app/auth/actions";

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, undefined);

  return (
    <form action={formAction} className="ec-stack">
      <input type="hidden" name="next" value={next} />

      <label className="ec-label">
        <span>Email</span>
        <input className="ec-input" name="email" type="email" placeholder="equipo@ong.org" required />
      </label>

      <label className="ec-label">
        <span>Contraseña</span>
        <input className="ec-input" name="password" type="password" placeholder="••••••••" required />
      </label>

      {state?.error ? <p className="ec-error">{state.error}</p> : null}

      <button className="ec-btn ec-btn-primary ec-btn-block" type="submit" disabled={pending}>
        {pending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
