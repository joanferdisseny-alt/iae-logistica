import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { UniformityImportForm } from "./import-form";
import { GeneralImportForm } from "./general-form";
import type { ImportField } from "@/lib/inventory/import-model";

export const dynamic = "force-dynamic";
export default async function ImportsPage() {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");
  const sitesPromise = readAllRows((from, to) => supabase.from("headquarters").select("id, name").eq("is_active", true).order("name").order("id").range(from, to).returns<{ id: string; name: string }[]>());
  const destinations = async (table: "locations" | "inventory_containers") => readAllRows((from, to) => supabase.from(table).select("id, name, headquarters_id").eq("is_active", true).order("name").order("id").range(from, to).returns<{ id: string; name: string; headquarters_id: string }[]>());
  const fieldsPromise = readAllRows((from, to) => supabase.from("inventory_fields").select("key:field_key, label, type:field_type").order("field_key").range(from, to).returns<ImportField[]>());
  const [sites, locations, containers, fields] = await Promise.all([sitesPromise, destinations("locations"), destinations("inventory_containers"), fieldsPromise]);
  return <section className="ec-card"><div className="ec-card-header"><h1 className="ec-h2">Importar stock</h1><span className="ec-badge ec-badge-neutral">Catálogo general</span></div><div className="ec-card-body ec-stack">
    <GeneralImportForm sites={sites} locations={locations} containers={containers} fields={fields} />
    <details className="ec-import-legacy"><summary>¿Tienes el Excel antiguo de uniformidad con tallas en columnas?</summary><p className="ec-help">Este formato conserva su asistente de carga inicial: las tallas vacías no existen y los ceros sí. Para reposiciones usa el importador general con el SKU del artículo.</p><UniformityImportForm sites={sites} locations={locations} containers={containers} /></details>
  </div></section>;
}
