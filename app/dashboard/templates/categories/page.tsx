import Link from "next/link";
import { requireAccess } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import {
  CreateCategoryModal,
  EditCategoryForm
} from "@/app/dashboard/templates/forms";
import { CatalogTable } from "../catalog-table";
import { categoryBranch, categoryOptions } from "@/lib/inventory/categories";

export const dynamic = "force-dynamic";

type CategoryRow = {
  code: string;
  name: string;
  description: string | null;
  parent_code: string | null;
};

export default async function TemplateCategoriesPage() {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");

  const categories: CategoryRow[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("inventory_categories")
      .select("code, name, description, parent_code").order("name").order("code")
      .range(from, from + 499).returns<CategoryRow[]>();
    if (error || !data) throw new Error("No se ha podido cargar el catálogo de categorías. Comprueba que se haya aplicado supabase/upgrade-category-hierarchy.sql.");
    categories.push(...data);
    if (data.length < 500) break;
  }
  const options = categoryOptions(categories);
  const byCode = new Map(categories.map(category => [category.code, category]));

  return (
    <div className="ec-page">


      <section className="ec-card">
        <div className="ec-card-header ec-row-wrap">
          <div className="ec-row ec-row-wrap">
            <h1 className="ec-h2">Categorías de inventario</h1>
            <span className="ec-badge ec-badge-neutral">{categories.length}</span>
          </div>
          <CreateCategoryModal categories={options} />
        </div>
        <p className="ec-section-intro">Agrupa el catálogo por familias. Una subcategoría es una categoría con otra superior: Uniformidad / Primera equipación.</p>
        <CatalogTable
          searchable
          columns={[{ label: "Categoría / subcategoría", className: "ec-template-name-column" }, { label: "Código" }]}
          caption="Selecciona una categoría para ver su descripción o editarla."
          emptyMessage="Todavía no hay categorías configuradas. Crea la primera con «Nueva categoría»."
          rows={options.map(option => {
            const category = byCode.get(option.code)!;
            const excludedParents = new Set(categoryBranch(category.code, categories));
            return {
              id: category.code, label: option.name, searchText: category.code, cells: [<code key="code">{category.code}</code>],
              details: <div className="ec-template-detail-heading">
                <div className="ec-template-description">
                  <h2 className="ec-h3">Descripción</h2>
                  <p className="ec-muted">{category.description || "Sin descripción."}</p>
                  <p className="ec-help">Solo se puede eliminar si no tiene subcategorías, fichas ni artículos asociados. Los campos se configuran en cada ficha.</p>
                </div>
                <div className="ec-actions ec-template-detail-tools">
                  <Link className="ec-btn" href={`/dashboard/inventory?category=${encodeURIComponent(category.code)}`}>Ver artículos</Link>
                  <CreateCategoryModal categories={options} parentCode={category.code} />
                  <EditCategoryForm category={category} categories={options.filter(parent => !excludedParents.has(parent.code))} />
                </div>
              </div>
            };
          })}
        />
      </section>
    </div>
  );
}
