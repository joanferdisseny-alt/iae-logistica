"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ActionForm } from "@/app/dashboard/action-form";
import { updateUserAccess } from "@/app/dashboard/actions";
import { NotificationPreferencesModal } from "@/app/dashboard/inventory/notification-preferences-form";
import { getUserContact } from "./contact-action";
import type { AdminProfileRow, HeadquartersRow, RoleRecord } from "./model";

export function UserContact({ member }: { member: AdminProfileRow }) {
  const [contact, setContact] = useState<{ email?: string; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getUserContact(member.id).then(result => {
      if (!cancelled) setContact(result);
    }).catch(() => {
      if (!cancelled) setContact({ error: "No se pudo cargar el correo del usuario." });
    });
    return () => { cancelled = true; };
  }, [member.id, attempt]);
  return <div className="ec-stack">
    {!contact ? <p className="ec-help" role="status">Cargando correo...</p> : contact.error ? <div>
      <p className="ec-error" role="alert">{contact.error}</p>
      <button className="ec-btn" type="button" onClick={() => { setContact(null); setAttempt(value => value + 1); }}>Reintentar correo</button>
    </div> : <p className="ec-help">Correo de acceso: <strong>{contact.email || "Sin correo"}</strong></p>}
    {(contact?.email !== undefined || member.notification_preferences) && <NotificationPreferencesModal initialValues={{
      profileId: member.id,
      notificationEmail: member.notification_preferences?.notification_email ?? contact?.email ?? "",
      expiryWarningDays: member.notification_preferences?.expiry_warning_days ?? 14,
      emailEnabled: member.notification_preferences?.email_notifications_enabled ?? false
    }} />}
  </div>;
}

export function EditUserModal({ member, roles, headquarters, isSelf }: {
  member: AdminProfileRow; roles: RoleRecord[]; headquarters: HeadquartersRow[]; isSelf: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [role, setRole] = useState(member.app_roles?.code ?? "reader");
  const [site, setSite] = useState(member.headquarters_id ?? "");
  const [opening, setOpening] = useState(0);
  const initialRole = member.app_roles?.code ?? "reader";
  return <>
    <button type="button" className="ec-btn" ref={opener} onClick={() => {
      setRole(initialRole); setSite(member.headquarters_id ?? ""); setOpening(value => value + 1); dialog.current?.showModal();
    }}>Editar usuario</button>
    <dialog ref={dialog} className="ec-modal ec-modal-narrow" aria-labelledby={titleId}
      style={{ padding: 0, color: "inherit" }} onClose={() => opener.current?.focus()}>
      <div className="ec-modal-header">
        <h2 className="ec-h2" id={titleId}>Editar {member.full_name || "usuario"}</h2>
        <button className="ec-btn" type="button" onClick={() => dialog.current?.close()}>Cerrar</button>
      </div>
      <div className="ec-modal-body">
        <ActionForm key={opening} action={updateUserAccess}>
          <div className="ec-stack">
            <input type="hidden" name="profileId" value={member.id} />
            <div className="ec-form-grid">
              <label className="ec-label"><span>Rol</span><select className="ec-select" name="roleCode" value={role} onChange={event => setRole(event.target.value)}>
                {!roles.some(option => option.code === initialRole) && <option value={initialRole}>{member.app_roles?.name ?? "Sin rol"}</option>}
                {roles.map(option => <option key={option.id} value={option.code}>{option.name}</option>)}
              </select></label>
              <label className="ec-label"><span>Sede</span><select className="ec-select" name="headquartersId" disabled={role === "admin"} required={role !== "admin"}
                value={role === "admin" ? "" : site} onChange={event => setSite(event.target.value)}>
                <option value="">{role === "admin" ? "Todas las sedes" : "Selecciona una sede"}</option>
                {headquarters.map(site => <option key={site.id} value={site.id} disabled={!site.is_active}>{site.name}{!site.is_active ? " (inactiva)" : ""}</option>)}
              </select></label>
              <label className="ec-label"><span>Estado</span><select className="ec-select" name="isActive" defaultValue={String(member.is_active)}>
                <option value="true">Activo</option><option value="false" disabled={isSelf}>Inactivo</option>
              </select></label>
              <label className="ec-label"><span>Responsable de logística</span><select className="ec-select" name="isLogisticsContact" defaultValue={String(member.is_logistics_contact)}>
                <option value="false">No</option><option value="true">Sí</option>
              </select></label>
            </div>
            <p className="ec-help">Los administradores acceden a todas las sedes. Editores y lectores necesitan una sede asignada.</p>
            <button className="ec-btn ec-btn-primary" type="submit">Guardar cambios</button>
          </div>
        </ActionForm>
      </div>
    </dialog>
  </>;
}
