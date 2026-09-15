"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { newChecklistId } from "@/app/dashboard/checklists/id";
import { manageStock } from "./stock-actions";
import { positionLabel, type StockPosition, type StockLot, type StockOption } from "./stock-model";

export function StockForm({ itemId, positions, lots, locations, containers }: {
  itemId: string; positions: StockPosition[]; lots: StockLot[]; locations: StockOption[]; containers: StockOption[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const request = useRef<FormData | null>(null);
  const busy = useRef(false);
  const titleId = useId();
  const router = useRouter();
  const [operation, setOperation] = useState("transfer");
  const [destination, setDestination] = useState("container");
  const [selectedLot, setSelectedLot] = useState("");
  const [sourceId, setSourceId] = useState("");
  const editingLot = lots.find(lot => lot.id === selectedLot);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ error?: string; success?: string; retry?: boolean }>({});
  const hasDestination = ["in","transfer","new_lot"].includes(operation);
  const hasSource = ["out","transfer","adjustment"].includes(operation);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const data = request.current ?? new FormData(event.currentTarget);
    if (!request.current) { data.set("requestId", newChecklistId()); request.current = data; }
    busy.current = true; setPending(true);
    let response;
    try { response = await manageStock(data); }
    catch { response = { error: "No se pudo confirmar. Reintenta la misma operación.", retry: true }; }
    if (!response.retry) request.current = null;
    setResult(response); setPending(false); busy.current = false;
    if (response.success) router.refresh();
  }
  return <>
    <button type="button" className="ec-btn ec-btn-primary" onClick={() => {
      if (!request.current) { setResult({}); form.current?.reset(); }
      dialog.current?.showModal();
    }}>Gestionar existencias</button>
    <dialog className="ec-modal ec-modal-narrow" ref={dialog} aria-labelledby={titleId} style={{ padding: 0, color: "inherit" }} onCancel={e => { if (pending) e.preventDefault(); }}>
      <div className="ec-modal-header"><h2 className="ec-h2" id={titleId}>Existencias por lote y destino</h2>
        <button type="button" className="ec-btn" disabled={pending} onClick={() => dialog.current?.close()}>Cerrar</button></div>
      <form ref={form} onSubmit={submit} className="ec-modal-body ec-stack">
        <fieldset className="ec-checklist-fieldset ec-stack" disabled={pending || result.retry || !!result.success}>
          <input type="hidden" name="itemId" value={itemId} />
          <label className="ec-label"><span>Operación</span><select className="ec-select" name="operation" value={operation} onChange={e => setOperation(e.target.value)}>
            <option value="transfer">Trasladar entre destinos</option><option value="in">Entrada en lote existente</option>
            <option value="out">Consumo / salida</option><option value="adjustment">Recuento de una existencia</option>
            <option value="new_lot">Nuevo lote / recepción</option><option value="edit_lot">Editar lote y caducidad</option>
          </select></label>
          <input type="hidden" name="expectedQuantity" value={hasSource ? positions.find(p => p.id === sourceId)?.quantity ?? "" : ""} />
          {hasSource ? <label className="ec-label"><span>Origen / existencia que se cuenta</span><select className="ec-select" name="sourceId" required value={sourceId} onChange={e => setSourceId(e.target.value)}>
            <option value="">Selecciona lote y ubicación</option>{positions.map(p => <option key={p.id} value={p.id}>{p.inventory_stock_lots.code} · {positionLabel(p)} · {p.quantity}</option>)}
          </select></label> : <input type="hidden" name="sourceId" value="" />}
          {["in","edit_lot"].includes(operation) ? <label className="ec-label"><span>Lote</span><select className="ec-select" name="lotId" required value={selectedLot} onChange={e => setSelectedLot(e.target.value)}>
            <option value="">Selecciona lote</option>{lots.map(l => <option key={l.id} value={l.id}>{l.code} · {l.expiration_date ?? "Sin caducidad"}</option>)}
          </select></label> : <input type="hidden" name="lotId" value="" />}
          {hasDestination ? <>
            <label className="ec-label"><span>Destino</span><select className="ec-select" name="destination" value={destination} onChange={e => setDestination(e.target.value)}>
              <option value="container">Caja</option><option value="location">Ubicación directa</option><option value="none">Sin ubicación asignada</option>
            </select></label>
            {destination === "location" ? <label className="ec-label"><span>Ubicación</span><select className="ec-select" name="locationId" required><option value="">Selecciona ubicación</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label> : <input type="hidden" name="locationId" value="" />}
            {destination === "container" ? <label className="ec-label"><span>Caja</span><select className="ec-select" name="containerId" required><option value="">Selecciona caja</option>{containers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : <input type="hidden" name="containerId" value="" />}
          </> : <><input type="hidden" name="destination" value="none" /><input type="hidden" name="locationId" value="" /><input type="hidden" name="containerId" value="" /></>}
          {["new_lot","edit_lot"].includes(operation) ? <div className="ec-form-grid" key={`${operation}-${selectedLot}`}>
            <label className="ec-label"><span>Código de lote</span><input className="ec-input" name="lotCode" maxLength={120} required defaultValue={operation === "edit_lot" ? editingLot?.code : ""} /></label>
            <label className="ec-label"><span>Caducidad (opcional)</span><input className="ec-input" name="expirationDate" type="date" defaultValue={operation === "edit_lot" ? editingLot?.expiration_date ?? "" : ""} /></label>
          </div> : <><input type="hidden" name="lotCode" value="" /><input type="hidden" name="expirationDate" value="" /></>}
          {operation !== "edit_lot" ? <label className="ec-label"><span>{operation === "adjustment" ? "Cantidad final contada en este destino y lote" : "Cantidad"}</span><input className="ec-input" name="quantity" inputMode="decimal" required placeholder="0,5" /></label> : <input type="hidden" name="quantity" value="0" />}
          <label className="ec-label"><span>Motivo</span><textarea className="ec-textarea" name="notes" rows={2} minLength={3} maxLength={2000} required /></label>
          <p className="ec-help">El recuento afecta solo al origen elegido. El traslado conserva el lote y el total. Los lotes con distinto código o caducidad se mantienen separados.</p>
        </fieldset>
        {result.error && <p className="ec-error" role="alert">{result.error}</p>}{result.success && <p className="ec-success" role="status">{result.success}</p>}
        {result.retry && <p className="ec-help">Se conservan los datos para evitar duplicados. No recargues hasta confirmar el resultado.</p>}
        {!result.success && <button className="ec-btn ec-btn-primary" disabled={pending}>{pending ? "Guardando..." : result.retry ? "Reintentar misma operación" : "Guardar operación"}</button>}
      </form>
    </dialog>
  </>;
}
