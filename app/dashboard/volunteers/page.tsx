import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { VolunteerModal, type Person, type Site } from "./forms";

export const dynamic = "force-dynamic";
export default async function VolunteersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; site?: string }> }) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 100);
  const raw = Number(params.page ?? 1);
  const page = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 100000) : 1;
  const sites = await readAllRows((a, b) => supabase.from("headquarters").select("id, name").eq("is_active", true).order("name").order("id").range(a, b).returns<Site[]>());
  const site = sites.some(s => s.id === params.site) ? params.site! : "";
  let query = supabase.from("volunteers").select("id, external_code, full_name, email, headquarters_id, profile_id", { count: "exact" });
  if (q) query = query.ilike("full_name", `%${q.replace(/[\\%_*]/g, "\\$&")}%`);
  if (site) query = query.eq("headquarters_id", site);
  const { data, error, count } = await query.order("full_name").order("id").range((page - 1) * 30, page * 30 - 1).returns<Person[]>();
  const href = (n: number) => `/dashboard/volunteers?${new URLSearchParams({ q, site, page: String(n) })}`;
  return <section className="ec-card"><div className="ec-card-header ec-row-wrap"><h1 className="ec-h2">Voluntarios y entregas</h1><VolunteerModal sites={sites} /></div>
    <div className="ec-card-body ec-stack"><p className="ec-help">Personal, acceso vinculado y material entregado. Las entregas históricas se registran sin restar el stock disponible.</p>
      <form className="ec-row ec-row-wrap"><label className="ec-label">Nombre<input className="ec-input" name="q" defaultValue={q} maxLength={100} placeholder="Buscar voluntario" /></label><label className="ec-label">Sede<select className="ec-select" name="site" defaultValue={site}><option value="">Todas las sedes</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="ec-btn" type="submit">Buscar</button></form>
      {error ? <p role="alert" className="ec-error">No se pudo cargar el personal. Comprueba que se ha ejecutado supabase/upgrade-uniformity.sql. No se muestra un listado parcial.</p> : <>
        <div className="ec-table-wrap"><table className="ec-table"><caption>{count ?? 0} voluntarios · página {page}</caption><thead><tr><th>Código</th><th>Nombre</th><th>Sede</th><th>Acceso</th><th>Ficha</th></tr></thead><tbody>{data?.map(p => <tr key={p.id}><td>{p.external_code}</td><td>{p.full_name}</td><td>{sites.find(s => s.id === p.headquarters_id)?.name ?? "Sede inactiva"}</td><td>{p.profile_id ? "Vinculado" : "Sin cuenta vinculada"}</td><td><Link className="ec-btn" href={`/dashboard/volunteers/${p.id}`}>Ver ficha</Link></td></tr>)}</tbody></table></div>
        {!data?.length && <p className="ec-help">No hay voluntarios para estos filtros.</p>}
        <nav className="ec-row" aria-label="Páginas de voluntarios">{page > 1 && <Link className="ec-btn" href={href(page - 1)}>Anterior</Link>}{page * 30 < (count ?? 0) && <Link className="ec-btn" href={href(page + 1)}>Siguiente</Link>}</nav>
      </>}
    </div></section>;
}
