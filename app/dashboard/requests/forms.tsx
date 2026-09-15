"use client";

import { useActionState, useId, useRef, useState } from "react";
import { RequestMaterialFields } from "./material-fields";
import { changeRequestStatus, createRequest } from "./actions";
import { statusLabels, type RequestStatus } from "./model";

export function CreateRequestModal({ headquarters, defaultHeadquartersId, isAdmin }: {
  headquarters: { id: string; name: string }[];
  defaultHeadquartersId: string | null;
  isAdmin: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [state, action, pending] = useActionState(createRequest, {});
  const [headquartersId, setHeadquartersId] = useState(defaultHeadquartersId ?? headquarters[0]?.id ?? "");
  return <>
    <button ref={opener} className="ec-btn ec-btn-primary" type="button" disabled={!headquarters.length}
      onClick={() => dialog.current?.showModal()}>Pedir material</button>
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      className="ec-modal ec-modal-narrow" style={{ padding: 0, color: "inherit" }}
      onClose={() => opener.current?.focus()}>
      <div className="ec-modal-header">
        <h2 id={titleId} className="ec-h2">Nueva solicitud</h2>
        <button className="ec-btn" type="button" onClick={() => dialog.current?.close()}>Cerrar</button>
      </div>
      <form action={action} className="ec-modal-body ec-stack">
        <fieldset className="ec-stack" disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <p id={descriptionId} className="ec-help">Solicita un material por solicitud. No se envia correo ni se modifica el stock.</p>
        <label className="ec-label"><span>Sede</span>
          <select name="headquartersId" className="ec-select" required disabled={!isAdmin}
            value={headquartersId} onChange={(event) => setHeadquartersId(event.target.value)}>
            {headquarters.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
        <RequestMaterialFields key={headquartersId} headquartersId={headquartersId} />
        <label className="ec-label"><span>Notas (opcional)</span>
          <textarea className="ec-textarea" name="notes" maxLength={2000} rows={3} />
        </label>
        {state.error && <p className="ec-error" role="alert">{state.error}</p>}
        <button className="ec-btn ec-btn-primary" type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Crear solicitud"}
        </button>
        </fieldset>
      </form>
    </dialog>
  </>;
}

export function RequestStatusForm({ requestId, status, options }: {
  requestId: string; status: RequestStatus; options: readonly RequestStatus[];
}) {
  const [state, action, pending] = useActionState(changeRequestStatus, {});
  if (!options.length) return null;
  return <form action={action} className="ec-stack">
    <input type="hidden" name="requestId" value={requestId} />
    <input type="hidden" name="expectedStatus" value={status} />
    <div className="ec-row ec-row-wrap">
      <label className="ec-label"><span>Nuevo estado</span>
        <select key={status} className="ec-select" name="status" defaultValue={options[0]} disabled={pending}>
          {options.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
        </select>
      </label>
      <button className="ec-btn" type="submit" disabled={pending}>{pending ? "Guardando..." : "Guardar estado"}</button>
    </div>
    {state.error && <p className="ec-error" role="alert">{state.error}</p>}
    {state.success && <p className="ec-success" role="status">{state.success}</p>}
  </form>;
}
