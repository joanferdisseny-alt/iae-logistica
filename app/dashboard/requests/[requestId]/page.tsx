import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRequestAccess } from "../access";
import { RequestStatusForm } from "../forms";
import { allowedStatuses, formatRequestDate, statusClasses, statusLabels, type RequestRow, type RequestStatus } from "../model";

export const dynamic = "force-dynamic";

export default async function RequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { supabase, user, profile, isAdmin, isLogisticsContact } = await requireRequestAccess();
  const { requestId } = await params;
  if (!z.string().uuid().safeParse(requestId).success) notFound();
  const { data: request, error } = await supabase.from("logistics_requests")
    .select("id, headquarters_id, created_by, item_id, material, quantity, unit, notes, status, created_at, updated_at, headquarters(name)")
    .eq("id", requestId).maybeSingle<RequestRow>();
  if (error) throw new Error("No se pudo cargar la solicitud.");
  if (!request) notFound();
  const { data: history, error: historyError } = await supabase.from("logistics_request_history")
    .select("id, actor_id, from_status, to_status, created_at").eq("request_id", request.id)
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .returns<{ id: string; actor_id: string; from_status: RequestStatus | null; to_status: RequestStatus; created_at: string }[]>();
  const canManage = isAdmin || (isLogisticsContact && profile.headquarters_id === request.headquarters_id);
  const options = allowedStatuses(request.status, canManage, request.created_by === user.id);
  return <div className="ec-page">
    <section className="ec-card">
      <div className="ec-card-header ec-row-wrap">
        <h1 className="ec-h1">{request.material}</h1>
        <Link className="ec-btn" href="/dashboard/requests">Volver a solicitudes</Link>
      </div>
      <div className="ec-card-body ec-stack">
        <div className="ec-row ec-row-wrap">
          <span className={`ec-badge ${statusClasses[request.status]}`}>{statusLabels[request.status]}</span>
          <strong>{request.quantity} {request.unit}</strong>
          <span>{request.headquarters?.name ?? "Sede no disponible"}</span>
        </div>
        <p className="ec-help">Creada: {formatRequestDate(request.created_at)}. Actualizada: {formatRequestDate(request.updated_at)}.</p>
        {request.item_id && <div><Link className="ec-btn" href={`/dashboard/inventory/${request.item_id}`}>Ver ficha del artículo referenciado</Link></div>}
        <p className="ec-help" style={{ overflowWrap: "anywhere" }}>Solicitante: {request.created_by === user.id ? "Tu" : request.created_by}</p>
        {request.notes && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{request.notes}</p>}
        <RequestStatusForm requestId={request.id} status={request.status} options={options} />
        {!options.length && <p className="ec-help">{["completed", "cancelled"].includes(request.status)
          ? "Solicitud cerrada. El historial se conserva."
          : "El responsable de logistica de tu sede gestiona el estado."}</p>}
      </div>
    </section>
    <section className="ec-card">
      <div className="ec-card-header"><h2 className="ec-h2">Historial</h2></div>
      <div className="ec-card-body">
        {historyError ? <p className="ec-error" role="alert">No se pudo cargar el historial.</p>
          : <ol className="ec-stack">{history?.map((event) => <li key={event.id}>
            <strong>{event.from_status ? `${statusLabels[event.from_status]} > ` : "Creacion: "}{statusLabels[event.to_status]}</strong>
            <div className="ec-help" style={{ overflowWrap: "anywhere" }}>{formatRequestDate(event.created_at)} / {event.actor_id === user.id ? "Tu" : event.actor_id}</div>
          </li>)}</ol>}
      </div>
    </section>
  </div>;
}
