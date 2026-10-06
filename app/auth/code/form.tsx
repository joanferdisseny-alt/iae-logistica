"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { requestAccessCode, setPasswordWithCode } from "./actions";

export function AccessCodeForm({ mode }: { mode: "activate" | "recover" }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [request, requestAction, requesting] = useActionState(requestAccessCode, undefined);
  const [result, passwordAction, saving] = useActionState(async (state: { error?: string; success?: string } | undefined, data: FormData) => {
    const response = await setPasswordWithCode(state, data);
    if (response.success) { setCode(""); setPassword(""); setRepeat(""); }
    return response;
  }, undefined);
  if (result?.success) return <div className="ec-stack"><p role="status" className="ec-success">{result.success}</p><Link className="ec-btn ec-btn-primary" href="/auth/sign-in">Iniciar sesión</Link></div>;
  return <div className="ec-stack">
    <form action={requestAction} className="ec-stack">
      <input type="hidden" name="mode" value={mode} />
      <label className="ec-label">Correo de tu cuenta<input className="ec-input" type="email" autoComplete="email" name="email" required maxLength={254} disabled={requesting || saving} value={email} onChange={e => setEmail(e.target.value)} /></label>
      <button className="ec-btn" type="submit" disabled={requesting || saving}>{requesting ? "Solicitando..." : "Enviar / reenviar código"}</button>
      {request?.error && <p role="alert" className="ec-error">{request.error}</p>}
      {request?.success && <p role="status" className="ec-help">{request.success}</p>}
    </form>
    <form action={passwordAction} className="ec-stack">
      <input type="hidden" name="mode" value={mode} /><input type="hidden" name="email" value={email} />
      <p className="ec-help">Si ya has recibido el código de alta, no necesitas solicitar otro. Introduce arriba tu correo y completa estos datos.</p>
      <label className="ec-label">Código recibido<input className="ec-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code} onChange={e => setCode(e.target.value)} /></label>
      <label className="ec-label">Nueva contraseña<input className="ec-input" type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="ec-label">Repite la contraseña<input className="ec-input" type="password" name="repeat" autoComplete="new-password" minLength={12} maxLength={128} required value={repeat} onChange={e => setRepeat(e.target.value)} /></label>
      <p className="ec-help">Utiliza al menos 12 caracteres. El código solo puede utilizarse una vez.</p>
      {result?.error && <p role="alert" className="ec-error">{result.error}</p>}
      <button className="ec-btn ec-btn-primary" type="submit" disabled={saving || requesting || !email}>{saving ? "Verificando..." : "Verificar código y guardar contraseña"}</button>
    </form>
  </div>;
}
