"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { addAttachment, recordMovement, updateItem, type OperationState } from "./operations";

type OperationItem = {
  id: string;
  name: string;
  description: string | null;
  operational_status: string;
  current_stock: number | string;
  minimum_stock: number | string | null;
  unit: string | null;
  maintenance_due_at: string | null;
  expiration_date: string | null;
};
type Mode = "stock" | "edit" | "attachment";

export function OperationsForm({ item, distributedStock = false }: { item: OperationItem; distributedStock?: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const request = useRef<FormData | null>(null);
  const headingId = useId();
  const feedbackId = useId();
  const [mode, setMode] = useState<Mode>("stock");
  const [movementType, setMovementType] = useState("in");
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<OperationState>({});

  useEffect(() => {
    if (state.error || state.success) feedback.current?.focus();
  }, [state]);

  function open(nextMode: Mode) {
    if (submitting.current) return;
    if (!request.current) {
      setMode(nextMode);
      setState({});
      setMovementType("in");
      form.current?.reset();
    }
    dialog.current?.showModal();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const data = request.current ?? new FormData(event.currentTarget);
    if (mode === "stock" && !request.current) {
      data.set("requestId", crypto.randomUUID());
      request.current = data;
    }
    submitting.current = true;
    setPending(true);
    setState({});
    let result: OperationState;
    try {
      const action = mode === "stock" ? recordMovement : mode === "edit" ? updateItem : addAttachment;
      result = await action(undefined, data);
    } catch {
      result = {
        error: mode === "stock"
          ? "Respuesta no confirmada. Reintenta el mismo movimiento sin cambiar los datos."
          : "No se pudo confirmar el resultado. Comprueba la ficha y tu sesión antes de repetirlo.",
        retrySameRequest: mode === "stock"
      };
    }
    if (!result.retrySameRequest) request.current = null;
    setState(result);
    submitting.current = false;
    setPending(false);
    if (result.success) router.refresh();
  }

  function fieldError(name: string) {
    const messages = state.fieldErrors?.[name];
    return messages?.length ? <span className="ec-error">{messages.join(" ")}</span> : null;
  }

  const frozen = pending || Boolean(state.retrySameRequest) || Boolean(state.success);

  return (
    <>
      <div className="ec-actions ec-row-wrap">
        {!distributedStock && <button className="ec-btn ec-btn-primary" onClick={() => open("stock")} type="button">Mover stock</button>}
        <button className="ec-btn" onClick={() => open("edit")} type="button">Ficha y mantenimiento</button>
        <button className="ec-btn" onClick={() => open("attachment")} type="button">Añadir manual</button>
      </div>
      <dialog
        aria-labelledby={headingId}
        className="ec-modal ec-modal-narrow"
        onCancel={(event) => { if (submitting.current) event.preventDefault(); }}
        ref={dialog}
      >
        <div className="ec-modal-header">
          <h2 className="ec-h2" id={headingId}>
            {mode === "stock" ? "Movimiento de stock" : mode === "edit" ? "Ficha y mantenimiento" : "Enlace a manual o PDF"}
          </h2>
          <button className="ec-btn ec-btn-ghost" disabled={pending} onClick={() => dialog.current?.close()} type="button">Cerrar</button>
        </div>
        <div className="ec-modal-body">
          <form aria-busy={pending} aria-describedby={feedbackId} className="ec-stack" key={mode} onSubmit={submit} ref={form}>
            <input name="itemId" type="hidden" value={item.id} />
            <fieldset className="ec-stack" disabled={frozen}>
              <legend className="ec-help">{item.name}</legend>
              {mode === "stock" ? (
                <>
                  <p className="ec-help">Stock actual: {item.current_stock} {item.unit ?? "uds."}</p>
                  <label className="ec-label">
                    <span>Operación</span>
                    <select className="ec-select" name="type" onChange={(event) => setMovementType(event.target.value)} value={movementType}>
                      <option value="in">Entrada</option>
                      <option value="out">Salida</option>
                      <option value="adjustment">Ajuste por recuento</option>
                    </select>
                  </label>
                  <label className="ec-label">
                    <span>{movementType === "adjustment" ? "Stock final contado" : "Cantidad"}</span>
                    <input aria-invalid={Boolean(state.fieldErrors?.quantity)} className="ec-input" inputMode="decimal" maxLength={100} name="quantity" placeholder="0,5" required type="text" />
                    {fieldError("quantity")}
                    <span className="ec-help">Hasta 3 decimales. Puedes utilizar coma o punto.</span>
                  </label>
                  {movementType === "adjustment" ? <p className="ec-help">Sustituye el saldo por el total contado, no suma una diferencia. Se admite cero.</p> : null}
                </>
              ) : mode === "edit" ? (
                <>
                  <label className="ec-label"><span>Nombre</span><input className="ec-input" defaultValue={item.name} maxLength={200} minLength={2} name="name" required />{fieldError("name")}</label>
                  <label className="ec-label"><span>Descripción</span><textarea className="ec-textarea" defaultValue={item.description ?? ""} maxLength={5000} name="description" rows={2} />{fieldError("description")}</label>
                  <label className="ec-label">
                    <span>Estado operativo</span>
                    <select className="ec-select" defaultValue={item.operational_status} name="status" required>
                      <option value="available">Disponible</option><option value="in_use">En uso</option>
                      <option value="repair">En reparación</option><option value="inspection">En inspección</option>
                      <option value="retired">Retirado</option>
                    </select>
                    {fieldError("status")}
                  </label>
                  <div className="ec-form-grid">
                    <label className="ec-label"><span>Próximo mantenimiento</span><input className="ec-input" defaultValue={item.maintenance_due_at ?? ""} name="maintenanceDueAt" type="date" />{fieldError("maintenanceDueAt")}</label>
                    {distributedStock ? <><input type="hidden" name="expirationDate" value={item.expiration_date ?? ""} /><p className="ec-help">La caducidad se edita en cada lote, desde Existencias y ubicaciones.</p></> : <label className="ec-label"><span>Caducidad</span><input className="ec-input" defaultValue={item.expiration_date ?? ""} name="expirationDate" type="date" />{fieldError("expirationDate")}</label>}
                  </div>
                  <label className="ec-label"><span>Stock mínimo (vacío: sin mínimo)</span><input className="ec-input" defaultValue={item.minimum_stock ?? ""} inputMode="decimal" maxLength={100} name="minimumStock" />{fieldError("minimumStock")}</label>
                </>
              ) : (
                <>
                  <label className="ec-label"><span>Título</span><input className="ec-input" maxLength={200} name="title" required />{fieldError("title")}</label>
                  <label className="ec-label"><span>URL del manual o PDF</span><input className="ec-input" maxLength={2048} name="url" placeholder="https://ejemplo.org/manual.pdf" required type="url" />{fieldError("url")}</label>
                  <p className="ec-help">Solo se guarda el enlace HTTPS, sin credenciales. No se descarga ni se sube ningún archivo.</p>
                </>
              )}
              {mode !== "attachment" ? <label className="ec-label"><span>Motivo obligatorio (mínimo 3 caracteres)</span><textarea aria-invalid={Boolean(state.fieldErrors?.notes)} className="ec-textarea" maxLength={2000} minLength={3} name="notes" required rows={2} />{fieldError("notes")}</label> : null}
            </fieldset>
            <div aria-live="polite" id={feedbackId} ref={feedback} tabIndex={-1}>
              {state.error ? <p className="ec-error" role="alert">{state.error}</p> : null}
              {state.success ? <p className="ec-success" role="status">{state.success}</p> : null}
              {state.retrySameRequest ? <p className="ec-help">Se conservan los datos y el UUID original para un reintento seguro. Cerrar el popup no los descarta.</p> : null}
            </div>
            {!state.success ? <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">{pending ? "Guardando..." : state.retrySameRequest ? "Reintentar mismo movimiento" : "Guardar"}</button> : null}
          </form>
        </div>
      </dialog>
    </>
  );
}
