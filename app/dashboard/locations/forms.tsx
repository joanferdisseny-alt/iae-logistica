"use client";

import type { ReactNode } from "react";
import { useActionState, useState } from "react";
import {
  addItemToContainer,
  createInventoryContainer,
  createStorageLocation,
  deleteInventoryContainer,
  deleteStorageLocation,
  updateInventoryContainer,
  updateStorageLocation
} from "@/app/dashboard/actions";

type HeadquartersOption = {
  id: string;
  name: string;
};

type LocationOption = {
  id: string;
  name: string;
  headquarters_id?: string | null;
};

type EditableLocation = {
  id: string;
  name: string;
  code: string | null;
  location_type: string;
  description: string | null;
  parent_location_id: string | null;
  headquarters_id: string | null;
};

type EditableContainer = {
  id: string;
  name: string;
  code: string | null;
  container_type: string;
  description: string | null;
  location_id: string | null;
  headquarters_id: string | null;
};

type ItemOption = {
  id: string;
  name: string;
  currentStock: number;
  unit: string | null;
};

const locationTypeOptions = [
  ["room", "Sala / almacén"],
  ["cabinet", "Armario"],
  ["shelf", "Estantería / balda"],
  ["rack", "Rack"],
  ["vehicle", "Vehículo"],
  ["storage", "Zona de almacenamiento"],
  ["other", "Otro"]
] as const;

const containerTypeOptions = [
  ["intervention", "Intervención"],
  ["practice", "Prácticas"],
  ["storage", "Almacenamiento"],
  ["transport", "Transporte"]
] as const;

function LocationFields({
  canChooseHeadquarters,
  headquarters,
  location,
  locations,
  userHeadquartersId
}: {
  canChooseHeadquarters: boolean;
  headquarters: HeadquartersOption[];
  location?: EditableLocation;
  locations: LocationOption[];
  userHeadquartersId: string | null;
}) {
  const [selectedSite, setSelectedSite] = useState(location?.headquarters_id ?? userHeadquartersId ?? "");
  const parentOptions = locations.filter((option) => option.id !== location?.id && option.headquarters_id === selectedSite);

  return (
    <>
      {location ? <input name="id" type="hidden" value={location.id} /> : null}
      {canChooseHeadquarters ? (
        <label className="ec-label">
          <span>Sede</span>
          <select className="ec-select" name="headquartersId" required value={selectedSite} onChange={event => setSelectedSite(event.target.value)}>
            <option value="">Selecciona una sede</option>
            {headquarters.map((headquarter) => (
              <option key={headquarter.id} value={headquarter.id}>
                {headquarter.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input name="headquartersId" type="hidden" value={userHeadquartersId ?? location?.headquarters_id ?? ""} />
      )}

      <div className="ec-form-grid">
        <label className="ec-label">
          <span>Nombre</span>
          <input
            className="ec-input"
            name="name"
            placeholder="Estantería 1 · 3er estante"
            required
            defaultValue={location?.name ?? ""}
          />
        </label>
        <label className="ec-label">
          <span>Código</span>
          <input className="ec-input" name="code" placeholder="EST-01-B3" defaultValue={location?.code ?? ""} />
        </label>
      </div>

      <div className="ec-form-grid">
        <label className="ec-label">
          <span>Tipo</span>
          <select className="ec-select" name="locationType" defaultValue={location?.location_type ?? "shelf"}>
            {locationTypeOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="ec-label">
          <span>Dentro de</span>
          <select className="ec-select" name="parentLocationId" defaultValue={location?.parent_location_id ?? ""}>
            <option value="">Ubicación raíz</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="ec-label">
        <span>Descripción</span>
        <textarea className="ec-textarea" name="description" rows={3} defaultValue={location?.description ?? ""} />
      </label>
    </>
  );
}

function ContainerFields({
  canChooseHeadquarters,
  container,
  headquarters,
  locations,
  userHeadquartersId
}: {
  canChooseHeadquarters: boolean;
  container?: EditableContainer;
  headquarters: HeadquartersOption[];
  locations: LocationOption[];
  userHeadquartersId: string | null;
}) {
  const [selectedSite, setSelectedSite] = useState(container?.headquarters_id ?? userHeadquartersId ?? "");
  const visibleLocations = locations.filter(option => option.headquarters_id === selectedSite);
  return (
    <>
      {container ? <input name="id" type="hidden" value={container.id} /> : null}
      {canChooseHeadquarters ? (
        <label className="ec-label">
          <span>Sede</span>
          <select className="ec-select" name="headquartersId" required value={selectedSite} onChange={event => setSelectedSite(event.target.value)}>
            <option value="">Selecciona una sede</option>
            {headquarters.map((headquarter) => (
              <option key={headquarter.id} value={headquarter.id}>
                {headquarter.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input name="headquartersId" type="hidden" value={userHeadquartersId ?? container?.headquarters_id ?? ""} />
      )}

      <div className="ec-form-grid">
        <label className="ec-label">
          <span>Nombre</span>
          <input
            className="ec-input"
            name="name"
            placeholder="Caja intervención terremoto 01"
            required
            defaultValue={container?.name ?? ""}
          />
        </label>
        <label className="ec-label">
          <span>Código</span>
          <input className="ec-input" name="code" placeholder="INT-TER-01" defaultValue={container?.code ?? ""} />
        </label>
      </div>

      <div className="ec-form-grid">
        <label className="ec-label">
          <span>Tipo de caja</span>
          <select className="ec-select" name="containerType" defaultValue={container?.container_type ?? "intervention"}>
            {containerTypeOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="ec-label">
          <span>Ubicación física</span>
          <select className="ec-select" name="locationId" defaultValue={container?.location_id ?? ""}>
            <option value="">Sin ubicación fija</option>
          {visibleLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="ec-label">
        <span>Descripción</span>
        <textarea className="ec-textarea" name="description" rows={3} defaultValue={container?.description ?? ""} />
      </label>
    </>
  );
}

export function CreateLocationForm({
  canChooseHeadquarters,
  headquarters,
  locations,
  userHeadquartersId
}: {
  canChooseHeadquarters: boolean;
  headquarters: HeadquartersOption[];
  locations: LocationOption[];
  userHeadquartersId: string | null;
}) {
  const [state, formAction, pending] = useActionState(createStorageLocation, undefined);

  return (
    <form action={formAction} className="ec-stack">
      <LocationFields
        canChooseHeadquarters={canChooseHeadquarters}
        headquarters={headquarters}
        locations={locations}
        userHeadquartersId={userHeadquartersId}
      />

      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}

      <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
        {pending ? "Creando..." : "Crear ubicación"}
      </button>
    </form>
  );
}

export function EditLocationModal({
  canChooseHeadquarters,
  headquarters,
  location,
  locations,
  userHeadquartersId
}: {
  canChooseHeadquarters: boolean;
  headquarters: HeadquartersOption[];
  location: EditableLocation;
  locations: LocationOption[];
  userHeadquartersId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateStorageLocation, undefined);

  return (
    <>
      <button className="ec-btn" onClick={() => setOpen(true)} type="button">
        Editar
      </button>
      {open ? (
        <div className="ec-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div className="ec-modal ec-modal-narrow" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="ec-modal-header">
              <div className="ec-col">
                <div className="ec-muted-2">Ubicaciones</div>
                <h2 className="ec-h2">Editar ubicación</h2>
              </div>
              <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className="ec-modal-body">
              <form action={formAction} className="ec-stack">
                <LocationFields
                  canChooseHeadquarters={canChooseHeadquarters}
                  headquarters={headquarters}
                  location={location}
                  locations={locations}
                  userHeadquartersId={userHeadquartersId}
                />
                {state?.error ? <p className="ec-error">{state.error}</p> : null}
                {state?.success ? <p className="ec-success">{state.success}</p> : null}
                <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
                  {pending ? "Guardando..." : "Guardar cambios"}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function DeleteLocationForm({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(deleteStorageLocation, undefined);

  return (
    <form action={formAction} className="ec-stack-tight">
      <input name="id" type="hidden" value={id} />
      <button className="ec-btn ec-btn-danger" disabled={pending} type="submit">
        {pending ? "Borrando..." : "Borrar"}
      </button>
      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}
    </form>
  );
}

export function CreateContainerForm({
  canChooseHeadquarters,
  headquarters,
  locations,
  userHeadquartersId
}: {
  canChooseHeadquarters: boolean;
  headquarters: HeadquartersOption[];
  locations: LocationOption[];
  userHeadquartersId: string | null;
}) {
  const [state, formAction, pending] = useActionState(createInventoryContainer, undefined);

  return (
    <form action={formAction} className="ec-stack">
      <ContainerFields
        canChooseHeadquarters={canChooseHeadquarters}
        headquarters={headquarters}
        locations={locations}
        userHeadquartersId={userHeadquartersId}
      />

      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}

      <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
        {pending ? "Creando..." : "Crear caja"}
      </button>
    </form>
  );
}

export function EditContainerModal({
  canChooseHeadquarters,
  container,
  headquarters,
  locations,
  userHeadquartersId
}: {
  canChooseHeadquarters: boolean;
  container: EditableContainer;
  headquarters: HeadquartersOption[];
  locations: LocationOption[];
  userHeadquartersId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateInventoryContainer, undefined);

  return (
    <>
      <button className="ec-btn" onClick={() => setOpen(true)} type="button">
        Editar
      </button>
      {open ? (
        <div className="ec-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div className="ec-modal ec-modal-narrow" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="ec-modal-header">
              <div className="ec-col">
                <div className="ec-muted-2">Cajas y kits</div>
                <h2 className="ec-h2">Editar caja</h2>
              </div>
              <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className="ec-modal-body">
              <form action={formAction} className="ec-stack">
                <ContainerFields
                  canChooseHeadquarters={canChooseHeadquarters}
                  container={container}
                  headquarters={headquarters}
                  locations={locations}
                  userHeadquartersId={userHeadquartersId}
                />
                {state?.error ? <p className="ec-error">{state.error}</p> : null}
                {state?.success ? <p className="ec-success">{state.success}</p> : null}
                <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
                  {pending ? "Guardando..." : "Guardar cambios"}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function DeleteContainerForm({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(deleteInventoryContainer, undefined);

  return (
    <form action={formAction} className="ec-stack-tight">
      <input name="id" type="hidden" value={id} />
      <button className="ec-btn ec-btn-danger" disabled={pending} type="submit">
        {pending ? "Borrando..." : "Borrar"}
      </button>
      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}
    </form>
  );
}

export function AddContainerItemForm({
  containerId,
  items
}: {
  containerId: string;
  items: ItemOption[];
}) {
  const [state, formAction, pending] = useActionState(addItemToContainer, undefined);

  return (
    <form action={formAction} className="ec-inline-form">
      <input name="containerId" type="hidden" value={containerId} />
      <select className="ec-select" name="itemId" required defaultValue="">
        <option value="" disabled>
          Añadir artículo
        </option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · quedan {item.currentStock} {item.unit ?? "uds."}
          </option>
        ))}
      </select>
      <input className="ec-input" min="1" name="quantity" type="number" defaultValue="1" />
      <input className="ec-input" name="notes" placeholder="Notas" />
      <button className="ec-btn ec-btn-primary" disabled={pending} type="submit">
        Añadir
      </button>
      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}
    </form>
  );
}

export function LocationModal({
  children,
  title,
  trigger
}: {
  children: ReactNode;
  title: string;
  trigger: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn ec-btn-primary" onClick={() => setOpen(true)} type="button">
        {trigger}
      </button>
      {open ? (
        <div className="ec-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div className="ec-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="ec-modal-header">
              <h2 className="ec-h2">{title}</h2>
              <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className="ec-modal-body">{children}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
