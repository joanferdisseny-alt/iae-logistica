import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { UniformityImportForm } from "./import-form";

export const dynamic = "force-dynamic";
export default async function ImportsPage() {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");
  const sites = await readAllRows((from, to) => supabase.from("headquarters").select("id, name").eq("is_active", true).order("name").order("id").range(from, to).returns<{ id: string; name: string }[]>());
  const destinations = async (table: "locations" | "inventory_containers") => readAllRows((from, to) => supabase.from(table).select("id, name, headquarters_id").eq("is_active", true).order("name").order("id").range(from, to).returns<{ id: string; name: string; headquarters_id: string }[]>());
  const [locations, containers] = await Promise.all([destinations("locations"), destinations("inventory_containers")]);
  return <section className="ec-card"><div className="ec-card-header"><h1 className="ec-h2">Importar uniformidad</h1></div><div className="ec-card-body">
    <UniformityImportForm sites={sites} locations={locations} containers={containers} />
  </div></section>;
}
