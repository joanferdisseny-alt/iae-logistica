"use client";

import { useActionState, useState } from "react";
import { assignItemPlacement } from "@/app/dashboard/actions";

type LocationOption = {
  id: string;
  name: string;
};

type ContainerOption = {
  id: string;
  name: string;
};

type ItemPlacementFormProps = {
  currentContainerId: string | null;
  currentLocationId: string | null;
  itemId: string;
  locations: LocationOption[];
  containers: ContainerOption[];
  currentStock?: number;
};

export function ItemPlacementForm({
  currentContainerId,
  currentLocationId,
  itemId,
  locations,
  containers,
  currentStock = 1
}: ItemPlacementFormProps) {
  const [state, formAction, pending] = useActionState(assignItemPlacement, undefined);
  const [placementType, setPlacementType] = useState<"location" | "container" | "none">(
    currentContainerId ? "container" : currentLocationId ? "location" : "none"
  );

  return (
    <form action={formAction} className="ec-stack">
      <input name="itemId" type="hidden" value={itemId} />

      <label className="ec-label">
        <span>Dónde está este artículo</span>
        <select
          className="ec-select"
          name="placementType"
          onChange={(event) => setPlacementType(event.target.value as "location" | "container" | "none")}
          value={placementType}
        >
          <option value="location">Ubicación física directa</option>
          <option value="container">Dentro de una caja</option>
          <option value="none">Sin ubicación asignada</option>
        </select>
      </label>

      {placementType === "location" ? (
        <label className="ec-label">
          <span>Ubicación física</span>
          <select className="ec-select" name="locationId" defaultValue={currentLocationId ?? ""} required>
            <option value="">Selecciona ubicación</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {placementType === "container" ? (
        <>
          <label className="ec-label">
            <span>Caja</span>
            <select className="ec-select" name="containerId" defaultValue={currentContainerId ?? ""} required>
              <option value="">Selecciona caja</option>
              {containers.map((container) => (
                <option key={container.id} value={container.id}>
                  {container.name}
                </option>
              ))}
            </select>
          </label>

          <div className="ec-form-grid">
            <label className="ec-label">
              <span>Cantidad en la caja</span>
              <input name="quantity" type="hidden" value={currentStock} />
              <span>{currentStock} (partida completa)</span>
            </label>
            <label className="ec-label">
              <span>Notas</span>
              <input className="ec-input" name="notes" placeholder="Ej. compartimento interior" />
            </label>
          </div>
        </>
      ) : null}

      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}

      <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
        {pending ? "Guardando..." : "Guardar ubicación"}
      </button>
    </form>
  );
}
