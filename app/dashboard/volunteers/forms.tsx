"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { deliveryPositions, findDeliveryItems, recordDelivery, returnDelivery, saveVolunteer, searchVolunteerProfiles } from "./actions";

export type Site = { id: string; name: string };
export type Person = { id: string; external_code: string; full_name: string; email: string | null; headquarters_id: string; profile_id: string | null };
type Result = { error?: string; success?: string; uncertain?: boolean };

function Popup({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [opened, setOpened] = useState(false);
  return <><button ref={opener} type="button" className="ec-btn" onClick={() => { setOpened(true); ref.current?.showModal(); }}>{label}</button>
    <dialog ref={ref} className="ec-modal ec-modal-narrow" aria-labelledby={id} style={{ padding: 0, color: "inherit" }} onClose={() => opener.current?.focus()}>
      <div className="ec-modal-header"><h2 id={id} className="ec-h2">{title}</h2><button type="button" className="ec-btn" onClick={() => ref.current?.close()}>Cerrar</button></div>
      <div className="ec-modal-body">{opened ? children : null}</div>
    </dialog></>;
}

// Keep the exact request after an uncertain response: retrying must not deduct stock twice.
function Operation({ action, children, label }: { action: (data: FormData) => Promise<Result>; children: ReactNode; label: string }) {
  const [result, setResult] = useState<Result>({});
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [version, setVersion] = useState(0);
  const request = useRef<string | null>(null);
  const snapshot = useRef<FormData | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (!pending && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending, uncertain]);
  return <form className="ec-stack" onSubmit={async event => {
    event.preventDefault();
    if (busy.current || result.success) return;
    const data = snapshot.current ?? new FormData(event.currentTarget);
    request.current ??= crypto.randomUUID(); data.set("requestId", request.current);
    snapshot.current = data; busy.current = true; setPending(true); setResult({});
    try {
      const response = await action(data); setResult(response);
      if (!response.uncertain) snapshot.current = null;
      setUncertain(Boolean(response.uncertain));
    } catch {
      setUncertain(true); setResult({ error: "No se pudo confirmar el resultado. Reintenta aquí con la misma operación, sin crear otra entrega o devolución." });
    } finally { busy.current = false; setPending(false); }
  }}>
    <fieldset key={version} disabled={pending || uncertain || Boolean(result.success)} className="ec-stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>
    {result.error && <p role="alert" className="ec-error">{result.error}</p>}
    {result.success ? <><p role="status" className="ec-success">{result.success}</p><button type="button" className="ec-btn" onClick={() => { request.current = null; snapshot.current = null; setResult({}); setVersion(v => v + 1); }}>Nueva operación</button></> :
      <button type="submit" className="ec-btn ec-btn-primary" disabled={pending}>{pending ? "Guardando…" : uncertain ? "Reintentar la misma operación" : label}</button>}
  </form>;
}

function Lookup({ site, kind, onSelect }: { site: string; kind: "profile" | "item"; onSelect: (row: { id: string; label: string }) => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<{ id: string; label: string }[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!site || query.trim().length < 2) { setRows([]); setMessage(""); return; }
    setRows([]); setMessage("Buscando…");
    const timer = setTimeout(async () => {
      try {
        const result = kind === "profile" ? await searchVolunteerProfiles(query, site) : await findDeliveryItems(query, site);
        if (cancelled) return;
        setRows(result.rows.map(r => ({ id: r.id, label: "full_name" in r ? `${r.full_name || "Sin nombre"} · ${r.id}` : `${r.name} · ${r.current_stock} uds.` })));
        setMessage(result.error ?? (result.hasMore ? "Hay más resultados. Concreta la búsqueda." : !result.rows.length ? "Sin resultados." : ""));
      } catch { if (!cancelled) { setRows([]); setMessage("No se pudo completar la búsqueda."); } }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [site, kind, query]);
  return <div className="ec-stack"><label className="ec-label">{kind === "profile" ? "Buscar cuenta de acceso por nombre" : "Buscar artículo y talla"}
    <input className="ec-input" value={query} maxLength={100} disabled={!site} onChange={e => setQuery(e.target.value)} placeholder="Escribe al menos 2 letras" /></label>
    <p className="ec-help" role="status">{message}</p>
    {rows.length > 0 && <ul className="ec-stack" style={{ padding: 0, listStyle: "none", maxHeight: 220, overflow: "auto" }}>{rows.map(r => <li key={r.id}><button className="ec-btn" type="button" onClick={() => { onSelect(r); setQuery(""); }}>{r.label}</button></li>)}</ul>}
  </div>;
}

function PersonFields({ sites, person }: { sites: Site[]; person?: Person }) {
  const [site, setSite] = useState(person?.headquarters_id ?? "");
  const [profile, setProfile] = useState(person?.profile_id ? { id: person.profile_id, label: `Cuenta vinculada: ${person.profile_id}` } : null);
  return <>
    {person && <input type="hidden" name="id" value={person.id} />}
    <div className="ec-form-grid">
      <label className="ec-label">Código de voluntario<input className="ec-input" name="code" required maxLength={80} defaultValue={person?.external_code} /></label>
      <label className="ec-label">Nombre completo<input className="ec-input" name="name" required minLength={2} maxLength={160} defaultValue={person?.full_name} /></label>
      <label className="ec-label">Correo (opcional)<input className="ec-input" name="email" type="email" maxLength={254} defaultValue={person?.email ?? ""} /></label>
      <label className="ec-label">Sede<select className="ec-select" name="site" required value={site} onChange={e => { setSite(e.target.value); setProfile(null); }}><option value="">Selecciona sede</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    </div>
    <input name="profileId" type="hidden" value={profile?.id ?? ""} />
    <p className="ec-help">La ficha puede crearse sin cuenta. Para dar acceso, crea el usuario en Usuarios con rol Voluntario (acceso personal) y vincúlalo aquí. No se envían invitaciones automáticamente.</p>
    {profile ? <div className="ec-row ec-row-wrap"><span>{profile.label}</span><button type="button" className="ec-btn" onClick={() => setProfile(null)}>Desvincular cuenta</button></div> : <Lookup site={site} kind="profile" onSelect={setProfile} />}
  </>;
}
export function VolunteerModal(props: { sites: Site[]; person?: Person }) {
  return <Popup title={props.person ? "Editar voluntario" : "Nuevo voluntario"} label={props.person ? "Editar" : "Nuevo voluntario"}>
    <Operation action={saveVolunteer} label="Guardar voluntario"><PersonFields {...props} /></Operation>
  </Popup>;
}

function PositionSelect({ item, name, outgoing = false }: { item: string; name: string; outgoing?: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof deliveryPositions>> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false; setData(null);
    deliveryPositions(item).then(r => { if (!cancelled) setData(r); }).catch(() => { if (!cancelled) setData({ rows: [], error: "No se pudieron cargar las existencias." }); });
    return () => { cancelled = true; };
  }, [item, attempt]);
  return <div className="ec-stack"><label className="ec-label">{outgoing ? "Existencia de origen" : "Destino de la devolución"}
    <select key={`${item}-${attempt}`} name={name} className="ec-select" required defaultValue="" disabled={!data || Boolean(data.error)}><option value="">{data ? "Selecciona ubicación / caja y lote" : "Cargando…"}</option>
      {data?.rows.filter(r => !outgoing || r.quantity > 0).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select></label>{data?.error && <><p role="alert" className="ec-error">{data.error}</p><button className="ec-btn" type="button" onClick={() => setAttempt(n => n + 1)}>Reintentar</button></>}
    {data && !data.error && !data.rows.some(r => !outgoing || r.quantity > 0) && <p className="ec-help">No hay existencias disponibles. Revisa el artículo en Inventario.</p>}
  </div>;
}
function DeliveryFields({ person }: { person: Person }) {
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [mode, setMode] = useState("historical");
  return <>
    <input type="hidden" name="volunteerId" value={person.id} /><input type="hidden" name="itemId" value={item?.id ?? ""} />
    <label className="ec-label">Tipo de entrega<select className="ec-select" name="mode" value={mode} onChange={e => setMode(e.target.value)}><option value="historical">Histórica: ya estaba entregada</option><option value="issue">Nueva: sale ahora del almacén</option></select></label>
    <p className="ec-help">{mode === "historical" ? "No descuenta stock: el Excel solo incluye lo disponible en almacén." : "Descuenta existencias de la ubicación o caja seleccionada."}</p>
    {item ? <div className="ec-row ec-row-wrap"><strong>{item.label}</strong><button className="ec-btn" type="button" onClick={() => setItem(null)}>Cambiar artículo</button></div> : <Lookup kind="item" site={person.headquarters_id} onSelect={setItem} />}
    <div className="ec-form-grid"><label className="ec-label">Cantidad<input className="ec-input" name="quantity" type="number" required min={1} max={1000000} step={1} defaultValue={1} /></label>
      <label className="ec-label">Fecha de entrega{mode === "historical" ? " (si se conoce)" : ""}<input className="ec-input" type="date" name="date" required={mode === "issue"} /></label></div>
    {mode === "issue" && item && <PositionSelect key={item.id} item={item.id} name="sourceId" outgoing />}
    <label className="ec-label">Notas<textarea name="notes" className="ec-textarea" maxLength={1800} rows={2} /></label>
    <label className="ec-checkbox"><input key={mode} name="confirmed" type="checkbox" required />{mode === "historical" ? "Confirmo que es material ya entregado y no incluido en el stock disponible." : "Confirmo la entrega y la salida del stock seleccionado."}</label>
  </>;
}
export function DeliveryModal({ person }: { person: Person }) {
  return <Popup title={`Entregar material a ${person.full_name}`} label="Registrar entrega"><Operation action={recordDelivery} label="Registrar entrega"><DeliveryFields person={person} /></Operation></Popup>;
}
export function ReturnModal({ delivery }: { delivery: { id: string; item_id: string; material: string; quantity: number; returned_quantity: number } }) {
  return <Popup title={`Devolución: ${delivery.material}`} label="Devolver"><Operation action={returnDelivery} label="Registrar devolución">
    <input type="hidden" name="deliveryId" value={delivery.id} />
    <label className="ec-label">Cantidad a devolver<input className="ec-input" name="quantity" type="number" min={1} max={delivery.quantity - delivery.returned_quantity} step={1} required defaultValue={1} /></label>
    <PositionSelect item={delivery.item_id} name="destinationId" />
    <label className="ec-label">Motivo / estado del material<textarea className="ec-textarea" name="notes" minLength={3} maxLength={1800} required rows={2} /></label>
    <p className="ec-help">Solo registra aquí material reutilizable que vuelve al stock disponible. No registres como devolución ropa perdida o descartada.</p>
  </Operation></Popup>;
}
