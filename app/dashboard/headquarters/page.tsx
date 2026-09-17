import { requireAccess } from "@/lib/auth/context";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreateHeadquartersModal, DeleteHeadquartersForm, EditHeadquartersModal } from "./forms";
import { CatalogTable } from "../templates/catalog-table";

export const dynamic = "force-dynamic";

type HeadquartersRow = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  is_active: boolean;
};

export default async function HeadquartersPage() {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");

  async function loadHeadquarters() {
    const rows: HeadquartersRow[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabase.from("headquarters")
        .select("id, name, slug, address, city, province, country, is_active")
        .order("name").order("id").range(from, from + 499).returns<HeadquartersRow[]>();
      if (error || !data) return null;
      rows.push(...data);
      if (data.length < 500) return rows;
    }
  }

  async function loadCounts(table: "profiles" | "inventory_items") {
    const counts = new Map<string, number>();
    // Read every page: Supabase's response cap must not become a misleading total.
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabase.from(table).select("headquarters_id")
        .order("id").range(from, from + 499).returns<{ headquarters_id: string | null }[]>();
      if (error || !data) return null;
      for (const row of data) if (row.headquarters_id) counts.set(row.headquarters_id, (counts.get(row.headquarters_id) ?? 0) + 1);
      if (data.length < 500) return counts;
    }
  }

  const [headquarters, userCounts, itemCounts] = await Promise.all([
    loadHeadquarters(), loadCounts("profiles"), loadCounts("inventory_items")
  ]);
  const countCell = (counts: Map<string, number> | null, id: string) => counts
    ? <span className="ec-template-count">{counts.get(id) ?? 0}</span>
    : <span aria-label="No disponible" title="No se pudo cargar el total">N/D</span>;

  return <div className="ec-page">
    <section className="ec-card">
      <div className="ec-card-header ec-row-wrap">
        <div className="ec-row ec-row-wrap">
          <h1 className="ec-h2">Sedes</h1>
          {headquarters && <span className="ec-badge ec-badge-neutral">{headquarters.length}</span>}
        </div>
        <div className="ec-actions ec-row-wrap">
          <Link className="ec-btn" href="/dashboard">Volver al panel</Link>
          <CreateHeadquartersModal />
        </div>
      </div>
      {headquarters === null ? <p className="ec-error ec-template-empty" role="alert">No se han podido cargar las sedes. Vuelve a intentarlo; no se muestra un listado parcial.</p> : <>
        {(!userCounts || !itemCounts) && <p className="ec-error ec-template-empty" role="alert">No se han podido cargar todos los contadores. N/D indica un total no disponible, no cero.</p>}
        <CatalogTable
          columns={[
            { label: "Sede", className: "ec-headquarters-name-column" },
            { label: "Estado", className: "ec-headquarters-status-column" },
            { label: "Usuarios" }, { label: "Artículos" }
          ]}
          caption="Selecciona una sede para ver su ubicación, editarla o eliminarla."
          emptyMessage="Todavía no hay sedes creadas. Crea la primera con «Nueva sede»."
          rows={headquarters.map(headquarter => ({
            id: headquarter.id, label: headquarter.name,
            cells: [
              <span key="status" className={`ec-headquarters-status${headquarter.is_active ? " is-active" : ""}`}>{headquarter.is_active ? "Activa" : "Inactiva"}</span>,
              countCell(userCounts, headquarter.id), countCell(itemCounts, headquarter.id)
            ],
            details: <div className="ec-template-detail-heading">
              <div className="ec-template-description">
                <dl className="ec-headquarters-details">
                  <div><dt>Código</dt><dd><code>{headquarter.slug}</code></dd></div>
                  <div><dt>Ciudad</dt><dd>{headquarter.city || "Sin indicar"}</dd></div>
                  <div><dt>Provincia / zona</dt><dd>{headquarter.province || "Sin indicar"}</dd></div>
                  <div><dt>País</dt><dd>{headquarter.country || "Sin indicar"}</dd></div>
                  <div className="ec-headquarters-address"><dt>Dirección</dt><dd>{headquarter.address || "Sin dirección indicada"}</dd></div>
                </dl>
                <p className="ec-help">Los administradores ven todas las sedes. Editores y lectores trabajan solo con la sede asignada.</p>
              </div>
              <div className="ec-actions ec-template-detail-tools">
                <EditHeadquartersModal headquarters={headquarter} />
                <DeleteHeadquartersForm id={headquarter.id} />
              </div>
            </div>
          }))}
        />
      </>}
    </section>
  </div>;
}
