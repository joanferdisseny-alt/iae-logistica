import { requireAccess } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import {
  CreateCategoryModal,
  EditCategoryForm
} from "@/app/dashboard/templates/forms";
import { TemplatesSubnav } from "@/app/dashboard/templates/subnav";
import { CatalogTable } from "../catalog-table";

export const dynamic = "force-dynamic";

type CategoryRow = {
  code: string;
  name: string;
  description: string | null;
};

export default async function TemplateCategoriesPage() {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");

  const categories: CategoryRow[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("inventory_categories")
      .select("code, name, description").order("name").order("code")
      .range(from, from + 499).returns<CategoryRow[]>();
    if (error || !data) throw new Error("No se ha podido cargar el catálogo de categorías.");
    categories.push(...data);
    if (data.length < 500) break;
  }

  return (
    <div className="ec-page">
      <TemplatesSubnav />

      <section className="ec-card">
        <div className="ec-card-header ec-row-wrap">
          <div className="ec-row ec-row-wrap">
            <h1 className="ec-h2">Categorías de inventario</h1>
            <span className="ec-badge ec-badge-neutral">{categories.length}</span>
          </div>
          <CreateCategoryModal />
        </div>
        <CatalogTable
          columns={[{ label: "Categoría", className: "ec-template-name-column" }, { label: "Código" }]}
          caption="Selecciona una categoría para ver su descripción o editarla."
          emptyMessage="Todavía no hay categorías configuradas. Crea la primera con «Nueva categoría»."
          rows={categories.map(category => ({
            id: category.code, label: category.name, cells: [<code key="code">{category.code}</code>],
            details: <div className="ec-template-detail-heading">
              <div className="ec-template-description">
                <h2 className="ec-h3">Descripción</h2>
                <p className="ec-muted">{category.description || "Sin descripción."}</p>
                <p className="ec-help">Solo se puede eliminar si no hay fichas ni artículos usando esta categoría.</p>
              </div>
              <div className="ec-actions ec-template-detail-tools"><EditCategoryForm category={category} /></div>
            </div>
          }))}
        />
      </section>
    </div>
  );
}
