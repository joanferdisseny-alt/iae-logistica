"use client";
import { DialogFocus } from "@/app/dashboard/dialog-focus";

import { useActionState, useState } from "react";
import { saveNotificationPreferences } from "@/app/dashboard/actions";

type NotificationPreferences = {
  expiryWarningDays: number;
  emailEnabled: boolean;
  notificationEmail: string;
  profileId?: string;
};

export function NotificationPreferencesForm({
  initialValues
}: {
  initialValues: NotificationPreferences;
}) {
  const [state, formAction, pending] = useActionState(
    saveNotificationPreferences,
    undefined
  );

  return (
    <form action={formAction} className="ec-stack">
      {initialValues.profileId ? <input type="hidden" name="profileId" value={initialValues.profileId} /> : null}
      <label className="ec-label">
        <span>Email de aviso</span>
        <input
          className="ec-input"
          defaultValue={initialValues.notificationEmail}
          name="notificationEmail"
          type="email"
          placeholder="logistica@ong.org"
          required
        />
      </label>

      <label className="ec-label">
        <span>Días de antelación</span>
        <input
          className="ec-input"
          defaultValue={initialValues.expiryWarningDays}
          min="1"
          name="expiryWarningDays"
          type="number"
          required
        />
      </label>

      <label className="ec-checkbox">
        <input
          defaultChecked={initialValues.emailEnabled}
          name="emailEnabled"
          type="checkbox"
          value="true"
        />
        <span>Enviar avisos de caducidad, stock bajo y mantenimiento</span>
      </label>

      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}

      <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
        {pending ? "Guardando..." : "Guardar avisos"}
      </button>
    </form>
  );
}

export function NotificationPreferencesModal({
  initialValues
}: {
  initialValues: NotificationPreferences;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(true)} type="button">
        Avisos por caducidad
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
                <div className="ec-muted-2">Avisos</div>
                <h2 className="ec-h2">Configurar caducidades</h2>
              </div>
              <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>

            <div className="ec-modal-body ec-stack">
              <p className="ec-muted">
                Configura cuántos días antes quieres recibir el aviso y a qué email debe llegar.
              </p>
              <NotificationPreferencesForm initialValues={initialValues} />
              <div className="ec-help">
                El job automático usará esta configuración para crear alertas y enviar correos de reposición o revisión.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
