import Link from "next/link";
import { requireRequestAccess } from "./access";
import { CreateRequestModal } from "./forms";
import { formatRequestDate, requestStatuses, statusClasses, statusLabels, type RequestRow, type RequestStatus } from "./model";

export const dynamic = "force-dynamic";
const pageSize = 30;

export default async function RequestsPage({ searchParams }: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { supabase, profile, isAdmin, isLogisticsContact } = await requireRequestAccess();
  const params = await searchParams;
  const status = requestStatuses.includes(params.status as RequestStatus) ? params.status as RequestStatus : undefined;
  const rawPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1;
  let query = supabase.from("logistics_requests")
    .select("id, headquarters_id, created_by, item_id, material, quantity, unit, notes, status, created_at, updated_at, headquarters(name)", { count: "exact" })
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data: requests, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1).returns<RequestRow[]>();
  const { count: pendingCount, error: pendingError } = await supabase.from("logistics_requests")
    .select("id", { count: "exact", head: true }).eq("status", "pending");
  const { data: headquarters, error: headquartersError } = await supabase.from("headquarters")
    .select("id, name").eq("is_active", true).order("name").returns<{ id: string; name: string }[]>();
  const pageHref = (value: number) => `/dashboard/requests?page=${value}${status ? `&status=${status}` : ""}`;
  return <div className="ec-page">
    <section className="ec-card">
      <div className="ec-card-header ec-row-wrap">
        <div className="ec-col">
          <h1 className="ec-h1">Solicitudes de material</h1>
          <p className="ec-help">{isAdmin ? "Todas las sedes" : isLogisticsContact ? "Gestion de tu sede" : "Mis solicitudes"}</p>
        </div>
        <CreateRequestModal headquarters={headquarters ?? []} defaultHeadquartersId={profile.headquarters_id} isAdmin={isAdmin} />
      </div>
      <div className="ec-card-body ec-stack">
        <div className="ec-row ec-row-wrap">
          <Link href="/dashboard/requests?status=pending" className="ec-badge ec-badge-warn">
            {pendingError ? "Pendientes no disponibles" : `${pendingCount ?? 0} pendientes`}
          </Link>
          <form className="ec-row ec-row-wrap" method="get">
            <label className="ec-label"><span>Estado</span>
              <select className="ec-select" name="status" defaultValue={status ?? ""}>
                <option value="">Todos</option>
                {requestStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
              </select>
            </label>
            <button className="ec-btn" type="submit">Filtrar</button>
          </form>
        </div>
        {headquartersError ? <p className="ec-error" role="alert">No se pudieron cargar las sedes.</p>
          : !headquarters?.length && <p className="ec-help">No hay una sede activa disponible para crear solicitudes.</p>}
        {error ? <p className="ec-error" role="alert">No se pudieron cargar las solicitudes. {isAdmin ? "Comprueba que se ha ejecutado supabase/upgrade-2026-09-15.sql." : "Contacta con un administrador para comprobar la actualización de logística."}</p>
          : <>
            <div className="ec-table-wrap"><table className="ec-table">
              <caption className="ec-help">{count ?? 0} solicitudes visibles. Abre una para consultar el historial o gestionar su estado.</caption>
              <thead><tr><th scope="col">Material</th><th scope="col">Cantidad</th><th scope="col">Sede</th><th scope="col">Estado</th><th scope="col">Actualizada</th></tr></thead>
              <tbody>{requests?.map((request) => <tr key={request.id}>
                <td><Link href={`/dashboard/requests/${request.id}`}>{request.material}</Link>
                  {request.item_id && <div><Link className="ec-help" href={`/dashboard/inventory/${request.item_id}`}>Ver artículo</Link></div>}
                </td>
                <td>{request.quantity} {request.unit}</td>
                <td>{request.headquarters?.name ?? "Sede no disponible"}</td>
                <td><span className={`ec-badge ${statusClasses[request.status]}`}>{statusLabels[request.status]}</span></td>
                <td>{formatRequestDate(request.updated_at)}</td>
              </tr>)}</tbody>
            </table></div>
            {!requests?.length && <p className="ec-muted">No hay solicitudes en esta pagina.</p>}
            <nav aria-label="Paginas de solicitudes" className="ec-row ec-row-wrap">
              {page > 1 && <Link className="ec-btn" href={pageHref(page - 1)}>Anterior</Link>}
              <span className="ec-help">Pagina {page}</span>
              {page * pageSize < (count ?? 0) && <Link className="ec-btn" href={pageHref(page + 1)}>Siguiente</Link>}
            </nav>
          </>}
      </div>
    </section>
  </div>;
}
