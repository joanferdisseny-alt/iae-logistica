import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/context";
import { ChecklistLineForm, CloseChecklistForm } from "../forms";
import { checklistProgress, eventLabels, resultLabels, statusLabels, type Checklist, type ChecklistLine } from "../model";
import { formatRequestDate } from "@/app/dashboard/requests/model";

export const dynamic = "force-dynamic";

export default async function ChecklistPage({ params }: { params: Promise<{ checklistId: string }> }) {
  const { checklistId } = await params;
  if (!z.string().uuid().safeParse(checklistId).success) notFound();
  const { supabase, user, isAdmin } = await requireAccess();
  const { data: checklist, error } = await supabase.from("container_checklists").select("*").eq("id",checklistId).maybeSingle<Checklist>();
  if (error) throw new Error("No se pudo cargar el checklist. Comprueba su migración.");
  if (!checklist) notFound();
  const lines: ChecklistLine[] = [];
  for (let from=0; ; from+=500) {
    const response = await supabase.from("container_checklist_items").select("*").eq("checklist_id",checklistId)
      .order("item_name").order("id").range(from,from+499).returns<ChecklistLine[]>();
    if (response.error || !response.data) throw new Error("No se pudo cargar todo el contenido del checklist.");
    lines.push(...response.data);
    if (response.data.length<500) break;
  }
  const { data: managesSite, error: permissionError } = await supabase.rpc("can_manage_logistics_requests", { p_headquarters_id:checklist.headquarters_id });
  if (permissionError) throw new Error("No se pudieron comprobar los permisos de revisión.");
  const canEdit = checklist.status==='draft' && (isAdmin || checklist.created_by===user.id || managesSite===true);
  const progress = checklistProgress(lines);
  return <div className="ec-page">
    <section className="ec-card"><div className="ec-card-body ec-stack">
      <div className="ec-row ec-row-between ec-row-wrap"><div><span className="ec-help">{eventLabels[checklist.event_type]} · {checklist.event_date.split('-').reverse().join('/')}</span><h1 className="ec-h1">{checklist.event_name}</h1></div>
        <Link className="ec-btn" href="/dashboard/checklists">Volver</Link></div>
      <div className="ec-row ec-row-wrap"><Link href={`/dashboard/locations/containers/${checklist.container_id}`} className="ec-link-strong">{checklist.container_name}</Link>
        <span className={`ec-badge ${checklist.status==='complete' ? 'ec-badge-ok' : checklist.status==='issues' ? 'ec-badge-bad' : 'ec-badge-neutral'}`}>{statusLabels[checklist.status]}</span>
        {checklist.team_name && <span className="ec-help">Equipo: {checklist.team_name}</span>}</div>
      <p className="ec-help">Referencia guardada el {formatRequestDate(checklist.created_at)} por {checklist.created_by_name}. Ubicación de retorno: {checklist.location_name}.</p>
      <div className="ec-row ec-row-wrap"><strong>{progress.checked} / {progress.total} artículos comprobados</strong><span className="ec-help">{progress.issues} con incidencias</span></div>
      <progress className="ec-checklist-progress" aria-label="Artículos comprobados" max={Math.max(progress.total,1)} value={progress.checked} />
      {!canEdit && checklist.status==='draft' && <p className="ec-help">Puedes consultar esta revisión. La completa su autor o un responsable de logística.</p>}
      {checklist.closed_at && <p className="ec-help">Cerrada el {formatRequestDate(checklist.closed_at)} por {checklist.closed_by_name}. {checklist.box_returned ? "Caja devuelta a su ubicación." : "Retorno de la caja no confirmado."}</p>}
      {checklist.summary && <p className="ec-checklist-notes">{checklist.summary}</p>}
    </div></section>
    <div className="ec-checklist-lines">{lines.map(line => <section className="ec-card" key={line.id}>
      <div className="ec-card-body ec-stack">
        <div className="ec-row ec-row-between ec-row-wrap"><Link className="ec-link-strong" href={`/dashboard/inventory/${line.item_id}`}>{line.item_name}</Link>
          <span className={`ec-badge ${line.result==='ok' ? 'ec-badge-ok' : line.result==='pending' ? 'ec-badge-neutral' : 'ec-badge-bad'}`}>{resultLabels[line.result]}</span></div>
        {line.lot_code && <p className="ec-help">Lote: {line.lot_code} · Caducidad: {line.expiration_date ?? "Sin fecha"}</p>}
        <p className="ec-help">Esperado: <strong>{line.expected_quantity} {line.unit}</strong>{line.returned_quantity!==null ? ` · Devuelto: ${line.returned_quantity} ${line.unit}` : ''}</p>
        {line.checked_at && <p className="ec-help">Guardado por {line.checked_by_name} · {formatRequestDate(line.checked_at)}</p>}
        {canEdit ? <ChecklistLineForm key={`${line.id}-${line.revision}`} line={line} /> : line.notes && <p className="ec-checklist-notes">{line.notes}</p>}
      </div>
    </section>)}</div>
    {canEdit && <section className="ec-card"><div className="ec-card-header"><h2 className="ec-h2">Cerrar revisión</h2></div><div className="ec-card-body">
      <CloseChecklistForm id={checklist.id} pendingCount={progress.total-progress.checked} locationName={checklist.location_name} />
    </div></section>}
  </div>;
}
