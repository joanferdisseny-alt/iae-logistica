import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { DeliveryModal, ReturnModal, VolunteerModal, type Person, type Site } from "../forms";
import { CreateUserModal } from "../../create-user-form";

export const dynamic = "force-dynamic";
export default async function VolunteerPage({ params, searchParams }: { params: Promise<{ volunteerId: string }>; searchParams: Promise<{ page?: string }> }) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");
  const { volunteerId } = await params;
  if (!z.string().uuid().safeParse(volunteerId).success) notFound();
  const { data: person, error } = await supabase.from("volunteers").select("id, external_code, full_name, email, headquarters_id, profile_id").eq("id", volunteerId).maybeSingle<Person>();
  if (error) throw Error("No se pudo cargar la ficha del voluntario.");
  if (!person) notFound();
  const raw = Number((await searchParams).page ?? 1);
  const page = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 100000) : 1;
  const sites = await readAllRows((a, b) => supabase.from("headquarters").select("id, name").eq("is_active", true).order("name").order("id").range(a, b).returns<Site[]>());
  const deliveries = await supabase.from("volunteer_deliveries").select("id, item_id, material, size, quantity, returned_quantity, delivered_on, historical, notes", { count: "exact" })
    .eq("volunteer_id", person.id).order("created_at", { ascending: false }).order("id").range((page - 1) * 30, page * 30 - 1)
    .returns<{ id: string; item_id: string; material: string; size: string | null; quantity: number; returned_quantity: number; delivered_on: string | null; historical: boolean; notes: string }[]>();
  if (deliveries.error) throw Error("No se pudieron cargar todas las entregas de esta página.");
  return <section className="ec-card"><div className="ec-card-header ec-row-wrap"><div><h1 className="ec-h2">{person.full_name}</h1><p className="ec-help">{person.external_code} · {sites.find(s => s.id === person.headquarters_id)?.name ?? "Sin sede de referencia activa"}</p></div><div className="ec-row ec-row-wrap">{person.profile_id ? <><VolunteerModal sites={sites} person={person} /><DeliveryModal person={person} /></> : <CreateUserModal headquarters={sites} roles={[{ code: "volunteer", name: "Voluntario (acceso personal)" }]} label="Completar alta" initial={{ name: person.full_name, email: person.email ?? "", site: person.headquarters_id ?? "", code: person.external_code, volunteerId: person.id }} />}</div></div>
    <div className="ec-card-body ec-stack"><p className="ec-help">{person.profile_id ? "Cuenta de acceso vinculada" : "Sin cuenta de acceso vinculada"}{person.email ? ` · ${person.email}` : ""}</p>
      <div className="ec-table-wrap"><table className="ec-table"><caption>Entregas: {deliveries.count ?? 0} · página {page}</caption><thead><tr><th>Material</th><th>Talla</th><th>Entregado</th><th>Devuelto</th><th>En su poder</th><th>Fecha</th><th>Tipo</th><th>Acciones</th></tr></thead><tbody>{deliveries.data?.map(d => <tr key={d.id}><td><Link href={`/dashboard/inventory/${d.item_id}`}>{d.material}</Link>{d.notes && <details><summary className="ec-help">Notas</summary>{d.notes}</details>}</td><td>{d.size ?? "—"}</td><td>{d.quantity}</td><td>{d.returned_quantity}</td><td>{d.quantity - d.returned_quantity}</td><td>{d.delivered_on ?? "Sin fecha"}</td><td>{d.historical ? "Histórica" : "Salida de almacén"}</td><td>{d.quantity > d.returned_quantity && <ReturnModal delivery={d} />}</td></tr>)}</tbody></table></div>
      {!deliveries.data?.length && <p className="ec-help">Sin entregas en esta página.</p>}
      <nav className="ec-row ec-row-wrap" aria-label="Páginas de entregas">{page > 1 && <Link className="ec-btn" href={`?page=${page - 1}`}>Anterior</Link>}{page * 30 < (deliveries.count ?? 0) && <Link className="ec-btn" href={`?page=${page + 1}`}>Siguiente</Link>}<Link className="ec-btn" href="/dashboard/volunteers">Volver al personal</Link></nav>
    </div></section>;
}
