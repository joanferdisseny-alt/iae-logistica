"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { DialogFocus } from "@/app/dashboard/dialog-focus";
import { loadCreateItemOptions, loadOwnAlertOptions } from "./options";

const CreateForm = dynamic(() => import("./create-item-form").then(module => module.CreateInventoryItemForm), { loading: () => <p role="status">Preparando formulario…</p> });
const AlertsForm = dynamic(() => import("./notification-preferences-form").then(module => module.NotificationPreferencesForm), { loading: () => <p role="status">Preparando avisos…</p> });

function LoadedForm<T>({ load, children }: { load: () => Promise<T>; children: (data: T) => ReactNode }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    load().then(result => { if (!cancelled) setData(result); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [load, attempt]);
  return <div>
    {error ? <div className="ec-stack"><p className="ec-error" role="alert">No se ha podido preparar el formulario. Comprueba la conexión y tus permisos.</p><button className="ec-btn" type="button" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div> : data ? children(data) : <p role="status">Cargando opciones…</p>}
  </div>;
}

function LazyDialog<T>({ label, title, load, render, primary = false }: {
  label: string; title: string; load: () => Promise<T>; render: (data: T, setBusy: (busy: boolean) => void) => ReactNode; primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) setOpen(false); };
  return <>
    <button className={`ec-btn ${primary ? "ec-btn-primary" : ""}`} type="button" onClick={() => setOpen(true)}>{label}</button>
    {open && <div className="ec-modal-backdrop" role="presentation" onClick={close}>
      <div className="ec-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><DialogFocus />
        <div className="ec-modal-header"><h2 className="ec-h2">{title}</h2><button className="ec-btn" type="button" disabled={busy} onClick={close}>Cerrar</button></div>
        <div className="ec-modal-body"><LoadedForm load={load}>{data => render(data, setBusy)}</LoadedForm></div>
      </div>
    </div>}
  </>;
}

export function CreateItemModal() {
  return <LazyDialog label="Nuevo artículo" title="Añadir artículo" load={loadCreateItemOptions} primary
    render={(data, setBusy) => <CreateForm {...data} onBusy={setBusy} />} />;
}

export function InventoryAlertsModal() {
  return <LazyDialog label="Configurar avisos" title="Avisos de caducidad y reposición" load={loadOwnAlertOptions}
    render={(data, setBusy) => <AlertsForm initialValues={data} onBusy={setBusy} />} />;
}
