"use client";

import { useActionState } from "react";
import { addInventoryRelation } from "@/app/dashboard/actions";

type ItemOption = {
  id: string;
  name: string;
  currentStock: number;
  unit: string | null;
};

export function AddRelationForm({
  sourceItemId,
  options
}: {
  sourceItemId: string;
  options: ItemOption[];
}) {
  const [state, formAction, pending] = useActionState(addInventoryRelation, undefined);

  return (
    <form action={formAction} className="ec-stack">
      <input name="sourceItemId" type="hidden" value={sourceItemId} />

      <label className="ec-label">
        <span>Artículo relacionado</span>
        <select className="ec-select" defaultValue="" name="targetItemId" required>
          <option disabled value="">
            Selecciona un artículo
          </option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.currentStock} {item.unit ?? "uds."}
            </option>
          ))}
        </select>
      </label>

      <label className="ec-label">
        <span>Relación</span>
        <select className="ec-select" defaultValue="uses" name="relationType">
          <option value="uses">Usa</option>
          <option value="requires">Requiere</option>
          <option value="compatible_with">Compatible con</option>
        </select>
      </label>

      <label className="ec-label">
        <span>Cantidad necesaria</span>
        <input className="ec-input" defaultValue="1" min="1" name="quantityRequired" type="number" />
      </label>

      <label className="ec-label">
        <span>Notas</span>
        <textarea className="ec-textarea" name="notes" rows={3} />
      </label>

      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}

      <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
        {pending ? "Guardando..." : "Guardar relación"}
      </button>
    </form>
  );
}

