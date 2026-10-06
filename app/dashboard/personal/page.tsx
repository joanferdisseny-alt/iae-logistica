import Link from "next/link";
import { requirePersonalAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { CreateRequestModal } from "../requests/forms";

export const dynamic = "force-dynamic";
export default async function PersonalPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { supabase, user, profile, isAdmin } = await requirePersonalAccess();
  const rawPage = Number((await searchParams).page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1;
  const { data: person, error } = await supabase.from("volunteers").select("id, full_name, external_code").eq("profile_id", user.id).maybeSingle<{ id: string; full_name: string; external_code: string }>();
  if (error) throw Error("No se pudo cargar tu ficha personal. Consulta con administración la actualización de Uniformidad.");
  const sites = await readAllRows((from, to) => supabase.from("headquarters").select("id, name").eq("is_active", true).order("name").order("id").range(from, to).returns<{ id: string; name: string }[]>());
  const result = person ? await supabase.from("volunteer_deliveries").select("id, material, size, quantity, returned_quantity, delivered_on, historical", { count: "exact" })
    .eq("volunteer_id", person.id).order("created_at", { ascending: false }).order("id").range((page - 1) * 30, page * 30 - 1)
    .returns<{ id: string; material: string; size: string | null; quantity: number; returned_quantity: number; delivered_on: string | null; historical: boolean }[]>() : null;
  if (result?.error) throw Error("No se pudieron cargar tus entregas. No se muestra un listado parcial.");
  return <section className="ec-card"><div className="ec-card-header ec-row-wrap"><div><h1 className="ec-h2">Mi material</h1><p className="ec-help">{person?.full_name ?? profile.full_name}{person && ` · ${person.external_code}`}</p></div>
    <CreateRequestModal headquarters={sites} defaultHeadquartersId={profile.headquarters_id} isAdmin={isAdmin} personal />
  </div><div className="ec-card-body ec-stack">
    {!person ? <p className="ec-help">Tu cuenta todavía no está vinculada a una ficha de voluntario. Administración debe vincularla para mostrar tus entregas. Ya puedes pedir material.</p> :
      <div className="ec-table-wrap"><table className="ec-table"><caption>Material entregado y pendiente de devolver</caption><thead><tr><th>Material</th><th>Talla</th><th>Entregado</th><th>Devuelto</th><th>En tu poder</th><th>Fecha</th></tr></thead>
        <tbody>{result?.data?.map(d => <tr key={d.id}><td>{d.material}{d.historical && <span className="ec-help"> · Registro histórico</span>}</td><td>{d.size ?? "—"}</td><td>{d.quantity}</td><td>{d.returned_quantity}</td><td>{d.quantity - d.returned_quantity}</td><td>{d.delivered_on ?? "Sin fecha conocida"}</td></tr>)}</tbody>
      </table>{!result?.data?.length && <p className="ec-help">No hay entregas registradas en esta página.</p>}</div>}
    <nav className="ec-row ec-row-wrap" aria-label="Páginas de entregas">{page > 1 && <Link className="ec-btn" href={`/dashboard/personal?page=${page - 1}`}>Anterior</Link>}{page * 30 < (result?.count ?? 0) && <Link className="ec-btn" href={`/dashboard/personal?page=${page + 1}`}>Siguiente</Link>}<Link className="ec-btn" href="/dashboard/requests">Mis solicitudes</Link></nav>
  </div></section>;
}
