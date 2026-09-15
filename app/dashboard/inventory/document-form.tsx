"use client";
import { useActionState } from "react";
import { uploadDocument } from "./documents";

export function DocumentForm({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState(uploadDocument, undefined);
  return <details><summary className="ec-btn">Subir PDF o fotografía</summary>
    <form action={action} className="ec-stack">
      <input name="itemId" type="hidden" value={itemId} />
      <label className="ec-label">Título<input className="ec-input" name="title" maxLength={200} required /></label>
      <label className="ec-label">Archivo (máximo 4 MB)<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label>
      <button className="ec-btn" disabled={pending}>{pending ? "Subiendo..." : "Subir documento"}</button>
      {state?.error ? <p className="ec-error" role="alert">{state.error}</p> : null}
      {state?.success ? <p className="ec-success" role="status">{state.success}</p> : null}
    </form>
  </details>;
}
