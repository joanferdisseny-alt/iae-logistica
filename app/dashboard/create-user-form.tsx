"use client";
import { DialogFocus } from "@/app/dashboard/dialog-focus";

import { useActionState, useState } from "react";
import { createUser } from "@/app/dashboard/actions";

type RoleOption = {
  code: string;
  name: string;
};

type HeadquartersOption = {
  id: string;
  name: string;
};

export function CreateUserForm({
  headquarters,
  roles
}: {
  headquarters: HeadquartersOption[];
  roles: RoleOption[];
}) {
  const [state, formAction, pending] = useActionState(createUser, undefined);
  const [selectedRole, setSelectedRole] = useState(
    roles.some((role) => role.code === "reader") ? "reader" : roles[0]?.code ?? "reader"
  );
  const needsHeadquarters = selectedRole !== "admin";

  return (
    <form action={formAction} className="ec-stack">
      <label className="ec-label">
        <span>Nombre</span>
        <input
          className="ec-input"
          name="fullName"
          type="text"
          placeholder="Nombre y apellidos"
          required
        />
      </label>

      <label className="ec-label">
        <span>Email</span>
        <input className="ec-input" name="email" type="email" placeholder="persona@ong.org" required />
      </label>

      <label className="ec-label">
        <span>Contraseña temporal</span>
        <input
          className="ec-input"
          name="password"
          type="password"
          placeholder="Mínimo 8 caracteres"
          required
        />
      </label>

      <label className="ec-label">
        <span>Rol inicial</span>
        <select
          className="ec-select"
          name="roleCode"
          onChange={(event) => setSelectedRole(event.target.value)}
          value={selectedRole}
        >
          {roles.map((role) => (
            <option key={role.code} value={role.code}>
              {role.name}
            </option>
          ))}
        </select>
      </label>

      <label className="ec-label">
        <span>Sede asignada</span>
        <select
          className="ec-select"
          name="headquartersId"
          required={needsHeadquarters}
          disabled={!needsHeadquarters}
        >
          <option value="">
            {needsHeadquarters ? "Selecciona una sede" : "Acceso global"}
          </option>
          {headquarters.map((headquarter) => (
            <option key={headquarter.id} value={headquarter.id}>
              {headquarter.name}
            </option>
          ))}
        </select>
      </label>

      <label className="ec-checkbox"><input type="checkbox" name="isLogisticsContact" />Responsable de logística (recibe y gestiona solicitudes de su sede)</label>
      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}

      <button className="ec-btn ec-btn-primary ec-btn-block" type="submit" disabled={pending}>
        {pending ? "Creando..." : "Crear usuario"}
      </button>
    </form>
  );
}

export function CreateUserModal({
  headquarters,
  roles
}: {
  headquarters: HeadquartersOption[];
  roles: RoleOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn ec-btn-primary" onClick={() => setOpen(true)} type="button">
        Nuevo usuario
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
                <div className="ec-muted-2">Usuarios</div>
                <h2 className="ec-h2">Crear usuario</h2>
              </div>
              <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>

            <div className="ec-modal-body">
              <CreateUserForm headquarters={headquarters} roles={roles} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
