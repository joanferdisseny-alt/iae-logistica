"use client";

import { useActionState, useRef, useState } from "react";
import { BarcodeScanner } from "../receiving/scanner";
import { resolveChecklistScan, saveScannedReturn } from "./scan-actions";
import { parseStockQr } from "./scan-model";
import { resultLabels, type ChecklistLine } from "./model";

export function ScanReturns({ checklistId }: { checklistId: string }) {
  const [selected, setSelected] = useState<{ positionId: string; line: ChecklistLine } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const inFlight = useRef(false);

  async function read(value: string) {
    if (inFlight.current) return;
    const positionId = parseStockQr(value, window.location.origin);
    if (!positionId) {
      setError("Escanea el QR de existencias de esta aplicación, disponible en la caja o en la ficha del artículo. El QR general y el código de barras comercial no identifican el lote y destino.");
      return;
    }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await resolveChecklistScan(checklistId, positionId);
      if (result.error) setError(result.error);
      else if (result.line) setSelected({ positionId, line: result.line });
    } catch { setError("No se pudo comprobar el QR. Revisa la conexión y vuelve a intentarlo."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="ec-card">
    <div className="ec-card-header"><h2 className="ec-h2">Escanear devoluciones</h2></div>
    <div className="ec-card-body ec-stack">
      <p className="ec-help">Escanea la etiqueta de existencias de cada material. Confirma cuántas unidades vuelven y su estado. El QR identifica el grupo, no demuestra su cantidad ni modifica el stock.</p>
      {selected ? <ConfirmReturn key={`${selected.line.id}-${selected.line.revision}`} checklistId={checklistId} {...selected}
        onBack={() => { setSelected(null); setCode(""); setError(""); }} /> : <>
        {!busy && <BarcodeScanner onRead={value => { void read(value); }} />}
        <form className="ec-row ec-row-wrap" onSubmit={event => { event.preventDefault(); void read(code); }}>
          <label className="ec-label"><span>Enlace QR (lector externo o entrada manual)</span>
            <input className="ec-input" value={code} onChange={event => setCode(event.target.value)} maxLength={500} required disabled={busy} />
          </label>
          <button className="ec-btn" disabled={busy}>{busy ? "Comprobando..." : "Comprobar QR"}</button>
        </form>
      </>}
      {busy && <p className="ec-help" role="status">Identificando material...</p>}
      {error && <p className="ec-error" role="alert">{error}</p>}
    </div>
  </section>;
}

function ConfirmReturn({ checklistId, positionId, line, onBack }: {
  checklistId: string; positionId: string; line: ChecklistLine; onBack: () => void;
}) {
  const [state, action, pending] = useActionState(async (previous: { error?: string; success?: string }, form: FormData) => {
    try { return await saveScannedReturn(previous, form); }
    catch { return { error: "No se pudo confirmar el resultado. Vuelve a escanear: si ya se guardó, se indicará sin duplicarlo." }; }
  }, {});
  return <div className="ec-stack">
    <div role="status"><strong>{line.item_name}</strong><p className="ec-help">Lote: {line.lot_code ?? "Sin lote"} · Caducidad: {line.expiration_date ?? "Sin fecha"} · Esperadas: {line.expected_quantity} {line.unit}</p></div>
    {!state.success && <form action={action} className="ec-stack">
      <fieldset disabled={pending} className="ec-checklist-fieldset ec-stack">
        <input name="checklistId" type="hidden" value={checklistId} />
        <input name="positionId" type="hidden" value={positionId} />
        <input name="revision" type="hidden" value={line.revision} />
        <div className="ec-form-grid">
          <label className="ec-label"><span>Cantidad devuelta a esta caja</span>
            <input className="ec-input" name="quantity" type="number" min={0} max={line.expected_quantity} step="0.001" required />
          </label>
          <label className="ec-label"><span>Estado</span><select className="ec-select" name="result" defaultValue="ok">
            {Object.entries(resultLabels).filter(([key]) => key !== "pending").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </div>
        <label className="ec-label"><span>Nota (obligatoria si hay incidencias)</span><textarea className="ec-textarea" name="notes" rows={2} maxLength={2000} /></label>
        <button className="ec-btn ec-btn-primary" disabled={pending}>{pending ? "Guardando..." : "Confirmar devolución"}</button>
      </fieldset>
    </form>}
    {state.error && <p className="ec-error" role="alert">{state.error}</p>}
    {state.success && <p className="ec-success" role="status">{state.success}</p>}
    <button className="ec-btn" type="button" disabled={pending} onClick={onBack}>{state.success ? "Escanear siguiente" : "Volver al escáner"}</button>
  </div>;
}
