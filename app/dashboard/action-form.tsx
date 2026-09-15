"use client";

import { useActionState, type ReactNode } from "react";

type Result = { error?: string; success?: string } | undefined | void;
export function ActionForm({ action, children, className }: {
  action: (data: FormData) => Promise<Result>;
  children: ReactNode;
  className?: string;
}) {
  const [state, submit, pending] = useActionState(async (_previous: Result, data: FormData) => {
    try { return await action(data); }
    catch { return { error: "No se ha podido completar la operación. Inténtalo de nuevo." }; }
  }, undefined);
  return <form action={submit} className={className}>
    <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>
    {pending ? <p role="status">Guardando...</p> : null}
    {state?.error ? <p className="ec-error" role="alert">{state.error}</p> : null}
    {state?.success ? <p className="ec-success" role="status">{state.success}</p> : null}
  </form>;
}
