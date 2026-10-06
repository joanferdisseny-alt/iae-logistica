import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { type Person, type Site } from "./forms";
import { CreateUserModal } from "../create-user-form";

export const dynamic = "force-dynamic";
export default async function VolunteersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; site?: string; pending?: string }> }) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 100);
  const raw = Number(params.page ?? 1);
  const page = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 100000) : 1;
  const sites = await readAllRows((a, b) => supabase.from("headquarters").select("id, name").eq("is_active", true).order("name").order("id").range(a, b).returns<Site[]>());
  const site = sites.some(s => s.id === params.site) ? params.site! : "";
  const pending = params.pending === "1";
  const legacy = await supabase.from("volunteers").select("id", { count: "exact", head: true }).is("profile_id", null);
  if (legacy.error) throw Error("No se pudo comprobar el estado de las fichas de voluntarios.");
  let query = supabase.from("volunteers").select("id, external_code, full_name, email, headquarters_id, profile_id, is_active", { count: "exact" });
  query = pending ? query.is("profile_id", null) : query.not("profile_id", "is", null);
  if (q) query = query.ilike("full_name", `%${q.replace(/[\\%_*]/g, "\\$&")}%`);
  if (site) query = query.eq("headquarters_id", site);
  const { data, error, count } = await query.order("full_name").order("id").range((page - 1) * 30, page * 30 - 1).returns<Person[]>();
  const href = (n: number) => `/dashboard/volunteers?${new URLSearchParams({ q, site, page: String(n), ...(pending ? { pending: "1" } : {}) })}`;
  return <section className="ec-card"><div className="ec-card-header ec-row-wrap"><h1 className="ec-h2">Voluntarios y entregas</h1><div className="ec-row ec-row-wrap"><Link className="ec-btn" href="/dashboard/users/import">Importar CSV / Excel</Link><CreateUserModal headquarters={sites} roles={[{ code: "volunteer", name: "Voluntario (acceso personal)" }]} label="Nuevo voluntario" /></div></div>
    <div className="ec-card-body ec-stack"><p className="ec-help">Todos los usuarios aparecen aquí, tengan o no material entregado. Sus permisos se administran en Usuarios. Las entregas históricas no restan stock disponible.</p>
      {(legacy.count ?? 0) > 0 && <div className="ec-row ec-row-wrap"><Link className="ec-btn" href="/dashboard/volunteers">Con cuenta de acceso</Link><Link className="ec-btn" href="/dashboard/volunteers?pending=1">Fichas antiguas pendientes de alta ({legacy.count})</Link></div>}
      {pending && <p className="ec-help">Estas fichas antiguas aún no tienen usuario. Completa el correo y el alta desde su ficha; se conservarán todas sus entregas.</p>}
      <form className="ec-row ec-row-wrap">{pending && <input type="hidden" name="pending" value="1" />}<label className="ec-label">Nombre<input className="ec-input" name="q" defaultValue={q} maxLength={100} placeholder="Buscar voluntario" /></label><label className="ec-label">Sede<select className="ec-select" name="site" defaultValue={site}><option value="">Todas las sedes</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="ec-btn" type="submit">Buscar</button></form>
      {error ? <p role="alert" className="ec-error">No se pudo cargar el personal. Comprueba que se ha ejecutado supabase/upgrade-uniformity.sql. No se muestra un listado parcial.</p> : <>
        <div className="ec-table-wrap"><table className="ec-table"><caption>{count ?? 0} voluntarios · página {page}</caption><thead><tr><th>Código</th><th>Nombre</th><th>Sede</th><th>Acceso</th><th>Ficha</th></tr></thead><tbody>{data?.map(p => <tr key={p.id}><td style={{ overflowWrap: "anywhere" }}>{p.external_code}</td><td>{p.full_name}</td><td>{sites.find(s => s.id === p.headquarters_id)?.name ?? (p.headquarters_id ? "Sede inactiva" : "Sin sede de referencia")}</td><td>{p.profile_id ? p.is_active ? "Activo" : "Inactivo" : "Pendiente de alta"}</td><td><Link className="ec-btn" href={`/dashboard/volunteers/${p.id}`}>Ver ficha</Link></td></tr>)}</tbody></table></div>
        {!data?.length && <p className="ec-help">No hay voluntarios para estos filtros.</p>}
        <nav className="ec-row" aria-label="Páginas de voluntarios">{page > 1 && <Link className="ec-btn" href={href(page - 1)}>Anterior</Link>}{page * 30 < (count ?? 0) && <Link className="ec-btn" href={href(page + 1)}>Siguiente</Link>}</nav>
      </>}
    </div></section>;
}
