"use client";

import { useActionState, useId, useRef, useState } from "react";
import { createChecklist, saveChecklistLine, closeChecklist } from "./actions";
import { eventLabels, resultLabels, type BoxOption, type ChecklistLine, type CheckResult } from "./model";
import { newChecklistId } from "./id";

export function CreateChecklistModal({ boxes, defaultContainerId, today }: {
  boxes: BoxOption[]; defaultContainerId?: string; today: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [id, setId] = useState("");
  return <>
    <button ref={opener} type="button" className="ec-btn ec-btn-primary" disabled={!boxes.length} onClick={() => {
      setId(newChecklistId()); dialog.current?.showModal();
    }}>Nuevo checklist</button>
    <dialog ref={dialog} className="ec-modal ec-modal-narrow" aria-labelledby={titleId}
      style={{ padding: 0, color: "inherit" }} onClose={() => opener.current?.focus()}>
      <div className="ec-modal-header"><h2 id={titleId} className="ec-h2">Revisar retorno de material</h2>
        <button className="ec-btn" type="button" onClick={() => dialog.current?.close()}>Cerrar</button>
      </div>
      {id && <CreateChecklistForm key={id} id={id} boxes={boxes} defaultContainerId={defaultContainerId} today={today} />}
    </dialog>
  </>;
}

function CreateChecklistForm({ id, boxes, defaultContainerId, today }: { id: string; boxes: BoxOption[]; defaultContainerId?: string; today: string }) {
  const [state, action, pending] = useActionState(createChecklist, {});
  return <form action={action} className="ec-modal-body ec-stack">
    <fieldset disabled={pending} className="ec-checklist-fieldset ec-stack">
      <input type="hidden" name="id" value={id} />
      <p className="ec-help">Se guardará el contenido actual de la caja como referencia. Crea el checklist antes de salir y complétalo al volver. No modifica el stock.</p>
      <label className="ec-label"><span>Caja</span><select className="ec-select" name="containerId" required defaultValue={defaultContainerId ?? ""}>
        <option value="" disabled>Selecciona una caja</option>
        {boxes.map(box => <option key={box.id} value={box.id}>{box.name}{box.headquarters ? ` · ${box.headquarters.name}` : ""}</option>)}
      </select></label>
      <div className="ec-form-grid">
        <label className="ec-label"><span>Tipo de actividad</span><select className="ec-select" name="eventType" defaultValue="practice">
          {Object.entries(eventLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label className="ec-label"><span>Fecha de actividad</span><input className="ec-input" name="eventDate" type="date" required defaultValue={today} /></label>
      </div>
      <label className="ec-label"><span>Actividad</span><input className="ec-input" name="eventName" required minLength={3} maxLength={160} placeholder="Entrenamiento de búsqueda y rescate" /></label>
      <label className="ec-label"><span>Equipo / grupo (opcional)</span><input className="ec-input" name="teamName" maxLength={120} /></label>
      {state.error && <p className="ec-error" role="alert">{state.error}</p>}
      <button className="ec-btn ec-btn-primary" disabled={pending}>{pending ? "Creando..." : "Crear checklist"}</button>
    </fieldset>
  </form>;
}

export function ChecklistLineForm({ line }: { line: ChecklistLine }) {
  const [state, action, pending] = useActionState(saveChecklistLine, {});
  const [result, setResult] = useState<CheckResult>(line.result);
  const hasIssue = !["pending", "ok"].includes(result);
  return <form action={action} className="ec-stack">
    <fieldset disabled={pending} className="ec-checklist-fieldset ec-stack">
      <input type="hidden" name="lineId" value={line.id} /><input type="hidden" name="revision" value={line.revision} />
      <div className="ec-checklist-controls">
        <label className="ec-label"><span>Resultado</span><select className="ec-select" name="result" value={result} onChange={event => setResult(event.target.value as CheckResult)}>
          {Object.entries(resultLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {hasIssue && <label className="ec-label"><span>Cantidad devuelta a la caja</span>
          <input className="ec-input" type="number" name="quantity" min={0} max={line.expected_quantity} step="0.001" defaultValue={line.returned_quantity ?? 0} />
        </label>}
      </div>
      {hasIssue && <label className="ec-label"><span>Incidencia / dónde está el material</span>
        <textarea className="ec-textarea" name="notes" maxLength={2000} rows={2} defaultValue={line.notes} />
      </label>}
      <div className="ec-row ec-row-wrap">
        <button className="ec-btn ec-btn-primary" name="intent" value="ok" formNoValidate disabled={pending}>Todo en su sitio</button>
        <button className="ec-btn" name="intent" value="save" disabled={pending}>{pending ? "Guardando..." : "Guardar resultado"}</button>
      </div>
      {state.error && <p className="ec-error" role="alert">{state.error}</p>}
      {state.success && <p className="ec-success" role="status">{state.success}</p>}
    </fieldset>
  </form>;
}

export function CloseChecklistForm({ id, pendingCount, locationName }: { id: string; pendingCount: number; locationName: string }) {
  const [state, action, pending] = useActionState(closeChecklist, {});
  return <form action={action} className="ec-stack">
    <fieldset disabled={pending} className="ec-checklist-fieldset ec-stack">
      <input type="hidden" name="id" value={id} />
      <label className="ec-checkbox"><input type="checkbox" name="boxReturned" /><span>La caja vuelve a su ubicación: {locationName}.</span></label>
      <label className="ec-label"><span>Resumen / incidencias de la caja</span><textarea className="ec-textarea" name="summary" maxLength={2000} rows={2} /></label>
      <p className="ec-help">{pendingCount ? `Quedan ${pendingCount} artículos sin comprobar.` : "Todos los artículos tienen resultado. Las incidencias quedarán registradas al cerrar."} El cierre conserva el historial y no ajusta existencias.</p>
      <button className="ec-btn ec-btn-primary" name="intent" value="close" disabled={pending || pendingCount>0}>{pending ? "Guardando..." : "Finalizar checklist"}</button>
      <details><summary className="ec-help">Cancelar una revisión creada por error</summary>
        <p className="ec-help">Escribe el motivo en el resumen. Se conserva el registro sin certificar el retorno.</p>
        <button className="ec-btn ec-btn-danger" name="intent" value="cancel" disabled={pending}>Cancelar revisión</button>
      </details>
      {state.error && <p className="ec-error" role="alert">{state.error}</p>}
      {state.success && <p className="ec-success" role="status">{state.success}</p>}
    </fieldset>
  </form>;
}
