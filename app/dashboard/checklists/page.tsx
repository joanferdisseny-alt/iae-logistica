import Link from "next/link";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/context";
import { CreateChecklistModal } from "./forms";
import { statusLabels, eventLabels, todayInSpain, type Checklist, type ChecklistStatus, type BoxOption } from "./model";

export const dynamic = "force-dynamic";

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<{ container?: string; status?: string; page?: string }> }) {
  const { supabase } = await requireAccess();
  const params = await searchParams;
  const container = z.string().uuid().safeParse(params.container).success ? params.container : undefined;
  const status = Object.hasOwn(statusLabels, params.status ?? "") ? params.status as ChecklistStatus : undefined;
  const rawPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage>0 ? Math.min(rawPage,100000) : 1;
  let query = supabase.from("container_checklists").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("id");
  if (container) query = query.eq("container_id", container);
  if (status) query = query.eq("status", status);
  const { data, error, count } = await query.range((page-1)*30,page*30-1).returns<Checklist[]>();
  const boxes: BoxOption[] = [];
  let boxesError = false;
  for (let from=0; ; from+=500) {
    const response = await supabase.from("inventory_containers").select("id, name, headquarters(name)").eq("is_active",true)
      .order("name").order("id").range(from,from+499).returns<BoxOption[]>();
    if (response.error || !response.data) { boxesError=true; break; }
    boxes.push(...response.data);
    if (response.data.length<500) break;
  }
  const href = (n: number) => `/dashboard/checklists?${new URLSearchParams({ page:String(n),...(status ? {status} : {}),...(container ? {container} : {}) })}`;
  return <div className="ec-page"><section className="ec-card">
    <div className="ec-card-header ec-row-wrap"><h1 className="ec-h1">Checklists de retorno</h1>
      {!error && !boxesError && <CreateChecklistModal boxes={boxes} defaultContainerId={container} today={todayInSpain()} />}
    </div>
    <div className="ec-card-body ec-stack">
      <p className="ec-help">Prácticas e intervenciones: guarda el contenido de la caja antes de salir y comprueba el retorno artículo por artículo. El historial no cambia el inventario.</p>
      <form method="get" className="ec-row ec-row-wrap">
        {container && <input type="hidden" name="container" value={container} />}
        <label className="ec-label"><span>Estado</span><select className="ec-select" name="status" defaultValue={status ?? ""}>
          <option value="">Todos</option>{Object.entries(statusLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
        </select></label><button className="ec-btn">Filtrar</button>
        {container && <Link className="ec-btn" href="/dashboard/checklists">Todas las cajas</Link>}
      </form>
      {error ? <p className="ec-error" role="alert">No se pudieron cargar los checklists. Comprueba que se ha ejecutado supabase/upgrade-checklists-2026-09-15.sql.</p> : <>
        {boxesError && <p className="ec-error">No se pudieron cargar las cajas para crear una revisión.</p>}
        <p className="ec-help">{count ?? 0} revisiones visibles</p>
        <div className="ec-list">{data?.map(checklist => <Link key={checklist.id} href={`/dashboard/checklists/${checklist.id}`} className="ec-checklist-list-row">
          <div><strong>{checklist.event_name}</strong><div className="ec-help">{checklist.container_name} · {checklist.event_date.split("-").reverse().join("/")} · {eventLabels[checklist.event_type]}</div>
            {checklist.team_name && <span className="ec-help">Equipo: {checklist.team_name}</span>}</div>
          <span className={`ec-badge ${checklist.status==='complete' ? 'ec-badge-ok' : checklist.status==='issues' ? 'ec-badge-bad' : 'ec-badge-neutral'}`}>{statusLabels[checklist.status]}</span>
        </Link>)}</div>
        {!data?.length && <p className="ec-muted">No hay revisiones con estos filtros.</p>}
        <nav className="ec-row" aria-label="Páginas de checklists">
          {page>1 && <Link className="ec-btn" href={href(page-1)}>Anterior</Link>}<span className="ec-help">Página {page}</span>
          {page*30<(count ?? 0) && <Link className="ec-btn" href={href(page+1)}>Siguiente</Link>}
        </nav>
      </>}
    </div>
  </section></div>;
}
