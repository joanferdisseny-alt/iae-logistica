import { requireAccess } from "@/lib/auth/context";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AssignFieldToTemplateModal, CreateTemplateModal, EditTemplateForm, RemoveTemplateFieldForm } from "./forms";
import { TemplatesSubnav } from "./subnav";
import { TemplateTable } from "./template-table";

export const dynamic = "force-dynamic";

type CategoryRow = { code: string; name: string };
type FieldCatalogRow = { id: string; field_key: string; label: string };
type TemplateRow = {
  id: string; code: string; name: string; description: string | null; category_code: string;
  inventory_categories: { name: string } | null;
  inventory_template_fields: Array<{
    id: string; is_required: boolean; sort_order: number;
    inventory_fields: {
      id: string; field_key: string; label: string;
      field_type: "text" | "number" | "date" | "textarea" | "select" | "boolean";
      options: string[];
    } | null;
  }>;
};
const fieldTypeLabels = { text: "Texto", number: "Número", date: "Fecha", textarea: "Texto largo", select: "Selección", boolean: "Sí / no" };

export default async function TemplatesPage() {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");

  const [categoriesResponse, templatesResponse, fieldsResponse] = await Promise.all([
    supabase.from("inventory_categories").select("code, name").order("name").returns<CategoryRow[]>(),
    supabase.from("inventory_templates")
      .select("id, code, name, description, category_code, inventory_categories(name), inventory_template_fields(id, is_required, sort_order, inventory_fields(id, field_key, label, field_type, options))")
      .order("name").returns<TemplateRow[]>(),
    supabase.from("inventory_fields").select("id, field_key, label").order("label").returns<FieldCatalogRow[]>()
  ]);
  if (categoriesResponse.error || templatesResponse.error || fieldsResponse.error) {
    throw new Error("No se han podido cargar las fichas y su catálogo de campos.");
  }
  const categories = categoriesResponse.data ?? [];
  const templates = templatesResponse.data ?? [];
  const fields = fieldsResponse.data ?? [];

  return <div className="ec-page">
    <TemplatesSubnav />
    <section className="ec-card">
      <div className="ec-card-header ec-row-wrap">
        <div className="ec-row ec-row-wrap">
          <h1 className="ec-h2">Fichas actuales</h1>
          <span className="ec-badge ec-badge-neutral">{templates.length}</span>
        </div>
        <CreateTemplateModal categories={categories} />
      </div>
      <TemplateTable rows={templates.map((template) => {
        const assignedFields = (template.inventory_template_fields ?? [])
          .filter((assignment) => assignment.inventory_fields)
          .sort((a, b) => a.sort_order - b.sort_order);
        const assignedIds = new Set(assignedFields.map((assignment) => assignment.inventory_fields!.id));
        const availableFields = fields.filter((field) => !assignedIds.has(field.id));
        return {
          id: template.id,
          name: template.name,
          category: template.inventory_categories?.name ?? template.category_code,
          fieldCount: assignedFields.length,
          details: <>
            <div className="ec-template-detail-heading">
              <div className="ec-template-description">
                <span className="ec-help">Código: <code>{template.code}</code></span>
                {template.description && <p className="ec-muted">{template.description}</p>}
              </div>
              <div className="ec-actions ec-template-detail-tools">
                <EditTemplateForm categories={categories} template={{
                  id: template.id, code: template.code, name: template.name,
                  description: template.description, categoryCode: template.category_code
                }} />
                <AssignFieldToTemplateModal fields={availableFields.map((field) => ({
                  id: field.id, fieldKey: field.field_key, label: field.label
                }))} template={{ id: template.id, name: template.name }} />
              </div>
            </div>
            <div className="ec-row ec-row-between ec-row-wrap">
              <h2 className="ec-h3">Campos asignados ({assignedFields.length})</h2>
              <Link className="ec-help" href="/dashboard/templates/fields">Ver catálogo de campos</Link>
            </div>
            {assignedFields.length ? <div className="ec-assigned-field-grid">
              {assignedFields.map((assignment) => <div className="ec-assigned-field" key={assignment.id}>
                <div className="ec-assigned-field-main">
                  <strong>{assignment.inventory_fields!.label}</strong>
                  <span title={assignment.inventory_fields!.field_key}>
                    {assignment.inventory_fields!.field_key} · {fieldTypeLabels[assignment.inventory_fields!.field_type]}
                    {assignment.is_required ? " · obligatorio" : ""}
                  </span>
                </div>
                <RemoveTemplateFieldForm assignmentId={assignment.id} />
              </div>)}
            </div> : <p className="ec-help">Esta ficha no tiene campos. Pulsa «Añadir campo» para elegir uno del catálogo.</p>}
          </>
        };
      })} />
    </section>
  </div>;
}
