"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { memberTargets, suggestMemberTarget, type MemberRow, type MemberTarget } from "@/lib/members/import";
import type { ImportTable } from "@/lib/inventory/import-model";
import type { MemberRequest } from "@/lib/members/provision";
import { memberBatch, prepareMembers, previewMembers, processMember, readMembersFile } from "./actions";

export function MembersImportForm({ sites }: { sites: { id: string; name: string }[] }) {
  const router = useRouter();
  const [table, setTable] = useState<ImportTable | null>(null);
  const [filename, setFilename] = useState("");
  const [mapping, setMapping] = useState<MemberTarget[]>([]);
  const [site, setSite] = useState("");
  const [preview, setPreview] = useState<(MemberRow & { existing: boolean })[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const request = useRef("");
  const snapshot = useRef<FormData | null>(null);
  const busy = useRef(false);
  function formData() {
    const f = new FormData(); f.set("table", JSON.stringify(table)); f.set("mapping", JSON.stringify(mapping)); f.set("site", site); f.set("filename", filename); return f;
  }
  return <div className="ec-stack">
    <p className="ec-help">Una fila por persona: correo y nombre completo obligatorios; sede y código opcionales si seleccionas una sede general. Máximo 500 personas y 1 MB por carga. No incluyas contraseñas ni repitas una persona por cada prenda.</p>
    <a className="ec-link-strong" href="/plantilla-usuarios.csv" download>Descargar plantilla CSV</a>
    <form className="ec-stack" onSubmit={async event => {
      event.preventDefault(); if (busy.current) return;
      const data = new FormData(event.currentTarget); const file = data.get("file") as File;
      busy.current = true; setPending(true); setError(""); setTable(null); setPreview(null);
      try {
        const result = await readMembersFile(data);
        if (result.error) setError(result.error);
        if (result.table) { setTable(result.table); setMapping(result.table.headers.map(suggestMemberTarget)); setFilename(file.name); request.current = ""; }
      } catch { setError("No se pudo leer el archivo. No se han creado cuentas."); }
      finally { setPending(false); busy.current = false; }
    }}><label className="ec-label">Archivo CSV / Excel<input className="ec-input" type="file" name="file" accept=".csv,.xlsx" required disabled={pending || uncertain} /></label><button className="ec-btn" disabled={pending || uncertain}>Leer archivo</button></form>
    {table && <>
      <fieldset disabled={pending || uncertain} className="ec-stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label className="ec-label">Sede cuando la fila no la indique<select className="ec-select" value={site} onChange={e => { setSite(e.target.value); setPreview(null); }}><option value="">Elegir sede</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <div className="ec-table-wrap"><table className="ec-table ec-import-mapping"><caption>Relacionar columnas · {table.rows.length} personas</caption><thead><tr><th>Columna</th><th>Ejemplo</th><th>Dato de la cuenta</th></tr></thead><tbody>{table.headers.map((header, i) => <tr key={i}><td><strong>{header}</strong></td><td>{table.rows[0]?.[i]?.slice(0, 80)}</td><td><select aria-label={`Destino de ${header}`} className="ec-select" value={mapping[i]} onChange={e => { setMapping(m => m.map((c, n) => n === i ? e.target.value as MemberTarget : c)); setPreview(null); }}>{memberTargets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td></tr>)}</tbody></table></div>
        <button className="ec-btn" type="button" onClick={async () => {
          if (busy.current) return; busy.current = true; setPending(true); setError(""); setPreview(null);
          try { const r = await previewMembers(formData()); if (r.error) setError(r.error); if (r.rows) setPreview(r.rows); }
          catch { setError("No se pudo revisar el archivo. No se han creado cuentas."); }
          finally { busy.current = false; setPending(false); }
        }}>Revisar antes de importar</button>
      </fieldset>
      {preview && <>
        <p className="ec-help">{preview.filter(r => !r.existing).length} posibles altas · {preview.filter(r => r.existing).length} cuentas existentes. Los nuevos usuarios tendrán acceso personal. Los existentes conservan sus datos y permisos. La coincidencia se vuelve a comprobar al procesar; no se importa ni descuenta material.</p>
        <div className="ec-table-wrap" style={{ maxHeight: 360 }}><table className="ec-table ec-member-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Sede</th><th>Previsión</th></tr></thead><tbody>{preview.map(r => <tr key={r.email}><td data-label="Nombre">{r.name}</td><td data-label="Correo">{r.email}</td><td data-label="Sede">{sites.find(s => s.id === r.site)?.name}</td><td data-label="Previsión">{r.existing ? "Conservar cuenta" : "Crear / recuperar ficha antigua"}</td></tr>)}</tbody></table></div>
        <form className="ec-stack" onSubmit={async event => {
          event.preventDefault(); if (busy.current) return;
          request.current ||= crypto.randomUUID();
          const data = snapshot.current ?? formData(); data.set("requestId", request.current); data.set("confirmed", "on"); snapshot.current = data;
          busy.current = true; setPending(true); setError("");
          try {
            const r = await prepareMembers(data);
            if (r.error) {
              setError(r.error); setUncertain(Boolean(r.uncertain));
              if (!r.uncertain) { snapshot.current = null; request.current = ""; }
            }
            if (r.id) router.push(`/dashboard/users/import?batch=${r.id}`);
          } catch { setUncertain(true); setError("Resultado sin confirmar. Reintenta esta misma preparación o consulta su estado; no vuelvas a cargar el archivo."); }
          finally { busy.current = false; setPending(false); }
        }}>
          <label className="ec-checkbox"><input type="checkbox" required disabled={pending} />He revisado los correos y autorizo crear las cuentas y enviar sus códigos de acceso.</label>
          <button className="ec-btn ec-btn-primary" disabled={pending}>{pending ? "Preparando..." : uncertain ? "Reintentar la misma preparación" : "Confirmar y preparar altas"}</button>
          {uncertain && <Link className="ec-btn" href={`/dashboard/users/import?batch=${request.current}`}>Consultar el estado de esta carga</Link>}
        </form>
      </>}
    </>}
    {error && <p role="alert" className="ec-error">{error}</p>}
  </div>;
}

export function MemberBatch({ id, initial }: { id: string; initial: MemberRequest[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const stop = useRef(false), busy = useRef(false);
  const complete = (r: MemberRequest) => ["sent", "not_needed"].includes(r.mail_status);
  useEffect(() => () => { stop.current = true; }, []);
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  async function refresh() {
    const result = await memberBatch(id);
    if (result.error || !result.rows) throw Error(result.error);
    setRows(result.rows); return result.rows;
  }
  return <div className="ec-stack">
    <p className="ec-help">{rows.filter(complete).length} de {rows.length} filas completadas. Puedes cerrar y volver a esta carga desde el historial. Reintentar no duplica cuentas; los correos pendientes se procesan por separado.</p>
    <div className="ec-row ec-row-wrap"><button className="ec-btn ec-btn-primary" disabled={pending || rows.every(complete)} onClick={async () => {
      if (busy.current) return; busy.current = true; stop.current = false; setPending(true); setMessage("");
      try {
        const current = await refresh();
        for (const row of current.filter(r => !complete(r))) {
          if (stop.current) break;
          setMessage(`Procesando ${row.full_name}...`);
          const result = await processMember(row.id); await refresh();
          if (result.error) { setMessage(result.error); return; }
        }
        setMessage(stop.current ? "Proceso detenido. Puedes continuar más tarde." : "Carga completada. Los códigos han sido solicitados al servicio de correo; comprueba su entrega en Supabase.");
      } catch { setMessage("Proceso interrumpido. Actualiza el estado y reintenta esta carga. No vuelvas a cargar el archivo."); }
      finally { busy.current = false; setPending(false); }
    }}>{pending ? "Procesando..." : "Crear cuentas y enviar códigos pendientes"}</button>
      {pending && <button className="ec-btn" onClick={() => { stop.current = true; }}>Detener tras esta fila</button>}
      <button className="ec-btn" disabled={pending} onClick={() => refresh().catch(() => setMessage("No se pudo actualizar el estado."))}>Actualizar estado</button>
    </div>
    {message && <p className="ec-help" role="status">{message}</p>}
    <div className="ec-table-wrap"><table className="ec-table ec-member-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Cuenta</th><th>Código de acceso</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td data-label="Nombre">{r.full_name}</td><td data-label="Correo">{r.email}</td><td data-label="Cuenta">{r.state === "created" ? "Creada" : r.state === "existing" ? "Existente" : "Pendiente"}</td><td data-label="Código de acceso">{r.mail_status === "sent" ? "Solicitado" : r.mail_status === "not_needed" ? "Ya tiene contraseña" : r.last_error || "Pendiente"}</td></tr>)}</tbody></table></div>
  </div>;
}
