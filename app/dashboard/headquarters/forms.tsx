"use client";
import { DialogFocus } from "@/app/dashboard/dialog-focus";
import { ActionForm } from "@/app/dashboard/action-form";

import { useActionState, useState } from "react";
import {
  createHeadquarters,
  deleteHeadquarters,
  updateHeadquarters
} from "@/app/dashboard/actions";

type Headquarters = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  is_active: boolean;
};

function HeadquartersFields({ headquarters }: { headquarters?: Headquarters }) {
  return (
    <>
      {headquarters ? <input name="id" type="hidden" value={headquarters.id} /> : null}
      <input name="isActive" type="hidden" value={headquarters?.is_active === false ? "false" : "true"} />

      <div className="ec-form-grid">
        <label className="ec-label">
          <span>Nombre</span>
          <input
            className="ec-input"
            name="name"
            required
            type="text"
            defaultValue={headquarters?.name ?? ""}
            placeholder="Valencia"
          />
        </label>

        <label className="ec-label">
          <span>Código</span>
          <input
            className="ec-input"
            name="slug"
            type="text"
            defaultValue={headquarters?.slug ?? ""}
            placeholder="valencia"
          />
          <small className="ec-help">
            Identificador único. Si lo dejas vacío, se genera desde el nombre.
          </small>
        </label>

        <label className="ec-label">
          <span>Ciudad</span>
          <input className="ec-input" name="city" type="text" defaultValue={headquarters?.city ?? ""} />
        </label>

        <label className="ec-label">
          <span>Provincia / zona</span>
          <input className="ec-input" name="province" type="text" defaultValue={headquarters?.province ?? ""} />
        </label>
      </div>

      <label className="ec-label">
        <span>Dirección</span>
        <input className="ec-input" name="address" type="text" defaultValue={headquarters?.address ?? ""} />
      </label>

      <label className="ec-label">
        <span>País</span>
        <input className="ec-input" name="country" type="text" defaultValue={headquarters?.country ?? "España"} />
      </label>
    </>
  );
}

export function CreateHeadquartersForm() {
  const [state, formAction, pending] = useActionState(createHeadquarters, undefined);

  return (
    <form action={formAction} className="ec-stack">
      <HeadquartersFields />

      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}

      <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
        {pending ? "Creando..." : "Crear sede"}
      </button>
    </form>
  );
}

export function CreateHeadquartersModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn ec-btn-primary" onClick={() => setOpen(true)} type="button">
        Nueva sede
      </button>

      {open ? (
        <div className="ec-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            aria-modal="true"
            className="ec-modal ec-modal-narrow"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          ><DialogFocus />
            <div className="ec-modal-header">
              <div className="ec-col">
                <div className="ec-muted-2">Sedes</div>
                <h2 className="ec-h2">Crear sede</h2>
              </div>
              <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className="ec-modal-body">
              <CreateHeadquartersForm />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function EditHeadquartersModal({ headquarters }: { headquarters: Headquarters }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn" onClick={() => setOpen(true)} type="button">
        Editar
      </button>

      {open ? (
        <div className="ec-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            aria-modal="true"
            className="ec-modal ec-modal-narrow"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          ><DialogFocus />
            <div className="ec-modal-header">
              <div className="ec-col">
                <div className="ec-muted-2">Sedes</div>
                <h2 className="ec-h2">Editar sede</h2>
              </div>
              <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className="ec-modal-body">
              <ActionForm action={updateHeadquarters} className="ec-stack">
                <HeadquartersFields headquarters={headquarters} />
                <button className="ec-btn ec-btn-primary ec-btn-block" type="submit">
                  Guardar cambios
                </button>
              </ActionForm>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function DeleteHeadquartersForm({ id }: { id: string }) {
  return (
    <ActionForm action={deleteHeadquarters}>
      <input name="id" type="hidden" value={id} />
      <button className="ec-btn ec-btn-danger" type="submit">
        Eliminar
      </button>
    </ActionForm>
  );
}
