import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { memberBatch } from "./actions";
import { MemberBatch, MembersImportForm } from "./form";

export const dynamic = "force-dynamic";
export default async function ImportUsersPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard/personal");
  const { batch } = await searchParams;
  const sites = await readAllRows((a, b) => supabase.from("headquarters").select("id, name").eq("is_active", true).order("name").order("id").range(a, b).returns<{ id: string; name: string }[]>());
  const history = await supabase.from("member_imports").select("id, filename, created_at").order("created_at", { ascending: false }).limit(20);
  const result = batch ? await memberBatch(batch) : null;
  return <section className="ec-card"><div className="ec-card-header ec-row-wrap"><h1 className="ec-h2">Importar usuarios y voluntarios</h1><Link className="ec-btn" href="/dashboard/volunteers">Ver voluntarios</Link></div>
    <div className="ec-card-body ec-stack">
      <p className="ec-help">Todos los usuarios tienen ficha de voluntario, con independencia de sus permisos y de si han recibido material. El envío requiere configurar SMTP y las plantillas de código en Supabase.</p>
      {history.error ? <p role="alert" className="ec-error">Aplica supabase/upgrade-member-accounts.sql antes de importar cuentas.</p> : batch ? <>
        {result?.rows ? <MemberBatch key={batch} id={batch} initial={result.rows} /> : <p role="alert" className="ec-error">{result?.error}</p>}
        <Link className="ec-btn" href="/dashboard/users/import">Volver a las importaciones</Link>
      </> : <MembersImportForm sites={sites} />}
      <details><summary>Mis últimas 20 cargas y altas manuales</summary><ul>{history.data?.map(b => <li key={b.id}><Link href={`/dashboard/users/import?batch=${b.id}`}>{b.filename} · {String(b.created_at).slice(0, 16).replace("T", " ")} UTC</Link></li>)}</ul><p className="ec-help">Conserva la dirección de la carga si necesitas retomarla más adelante.</p></details>
    </div>
  </section>;
}
