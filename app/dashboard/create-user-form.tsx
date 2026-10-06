"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { createUser } from "@/app/dashboard/actions";

type Props = {
  headquarters: { id: string; name: string }[];
  roles: { code: string; name: string }[];
  initial?: { name: string; email: string; site: string; code: string; volunteerId: string };
};
export function CreateUserForm({ headquarters, roles, initial }: Props) {
  const [role, setRole] = useState("volunteer");
  const [result, setResult] = useState<{ error?: string; success?: string }>({});
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const snapshot = useRef<FormData | null>(null);
  const request = useRef("");
  const busy = useRef(false);
  return <form className="ec-stack" onSubmit={async event => {
    event.preventDefault();
    if (busy.current || result.success) return;
    const data = snapshot.current ?? new FormData(event.currentTarget);
    request.current ||= crypto.randomUUID(); data.set("requestId", request.current);
    snapshot.current = data; busy.current = true; setPending(true); setResult({});
    try {
      const response = await createUser(undefined, data); setResult(response);
      if ("prepared" in response && response.prepared) setLocked(true);
      else { snapshot.current = null; request.current = ""; }
    } catch {
      setLocked(true); setResult({ error: "No se pudo confirmar el resultado. Reintenta la misma alta o consulta su estado en Importar usuarios." });
    } finally { busy.current = false; setPending(false); }
  }}>
    <p className="ec-help">Se crea la cuenta y su ficha de voluntario. Recibirá un código por correo para elegir su contraseña. Si el correo ya existe, se conserva su cuenta, sede y permisos.</p>
    <fieldset disabled={pending || locked} className="ec-stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <input type="hidden" name="volunteerId" value={initial?.volunteerId ?? ""} />
      <label className="ec-label">Nombre<input className="ec-input" name="fullName" autoComplete="name" required minLength={2} maxLength={160} defaultValue={initial?.name} /></label>
      <label className="ec-label">Correo de acceso<input className="ec-input" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={initial?.email} /></label>
      <label className="ec-label">Código de voluntario (opcional)<input className="ec-input" name="code" maxLength={80} defaultValue={initial?.code} /></label>
      <div className="ec-form-grid">
        <label className="ec-label">Permisos<select className="ec-select" name="roleCode" value={role} onChange={e => setRole(e.target.value)}>
          {!roles.some(r => r.code === "volunteer") && <option value="volunteer">Voluntario (acceso personal)</option>}
          {roles.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select></label>
        <label className="ec-label">Sede de referencia<select className="ec-select" name="headquartersId" required={role !== "admin"} defaultValue={initial?.site ?? ""}>
          <option value="">{role === "admin" ? "Sin sede de referencia" : "Selecciona una sede"}</option>
          {headquarters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
      </div>
      {role === "admin" && <p className="ec-help">Mantiene acceso a todas las sedes. La sede de referencia permite registrar sus entregas personales.</p>}
      {role !== "volunteer" ? <label className="ec-checkbox"><input type="checkbox" name="isLogisticsContact" />Responsable de logística</label> : <p className="ec-help">Acceso personal: su ficha, sus entregas y sus solicitudes de material.</p>}
    </fieldset>
    {result.error && <p role="alert" className="ec-error">{result.error}</p>}
    {result.success && <p role="status" className="ec-success">{result.success}</p>}
    {!result.success && <button className="ec-btn ec-btn-primary" type="submit" disabled={pending}>{pending ? "Procesando..." : locked ? "Reintentar la misma alta" : "Crear cuenta y enviar código"}</button>}
    {locked && <Link className="ec-btn" href={`/dashboard/users/import?batch=${request.current}`}>Ver estado del alta</Link>}
  </form>;
}
export function CreateUserModal(props: Props & { label?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [version, setVersion] = useState(0);
  const title = useId();
  return <><button className="ec-btn ec-btn-primary" type="button" ref={opener} onClick={() => { setVersion(v => v + 1); dialog.current?.showModal(); }}>{props.label ?? "Nuevo usuario"}</button>
    <dialog className="ec-modal ec-modal-narrow" ref={dialog} aria-labelledby={title} style={{ padding: 0, color: "inherit" }} onClose={() => opener.current?.focus()}>
      <div className="ec-modal-header"><h2 className="ec-h2" id={title}>{props.initial ? "Completar cuenta del voluntario" : "Nuevo usuario / voluntario"}</h2><button className="ec-btn" type="button" onClick={() => dialog.current?.close()}>Cerrar</button></div>
      <div className="ec-modal-body">{version > 0 && <CreateUserForm key={version} {...props} />}</div>
    </dialog></>;
}
