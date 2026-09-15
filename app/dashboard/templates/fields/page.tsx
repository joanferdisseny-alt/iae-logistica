import { requireAccess } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import {
  CreateFieldCatalogModal,
  EditFieldForm
} from "@/app/dashboard/templates/forms";
import { SpecialKeysModal } from "@/app/dashboard/templates/special-keys-modal";
import { TemplatesSubnav } from "@/app/dashboard/templates/subnav";
import { CatalogTable } from "../catalog-table";

export const dynamic = "force-dynamic";

const fieldTypeLabels = { text: "Texto", number: "Número", date: "Fecha", textarea: "Texto largo", select: "Selección", boolean: "Sí / no" };
type TemplateFieldRow = {
  id: string;
  field_key: string;
  label: string;
  field_type: keyof typeof fieldTypeLabels;
  options: string[] | null;
};

export default async function TemplateFieldsPage() {
  const { supabase, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");

  const fields: TemplateFieldRow[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("inventory_fields")
      .select("id, field_key, label, field_type, options")
      .order("label").order("id").range(from, from + 499).returns<TemplateFieldRow[]>();
    if (error || !data) throw new Error("No se ha podido cargar el catálogo de campos.");
    fields.push(...data);
    if (data.length < 500) break;
  }

  return (
    <div className="ec-page">
      <TemplatesSubnav />

      <section className="ec-card">
        <div className="ec-card-header ec-row-wrap">
          <div className="ec-row ec-row-wrap">
            <h1 className="ec-h2">Campos de ficha</h1>
            <span className="ec-badge ec-badge-neutral">{fields.length}</span>
          </div>
          <div className="ec-actions">
            <SpecialKeysModal />
            <CreateFieldCatalogModal />
          </div>
        </div>
        <CatalogTable
          columns={[{ label: "Campo", className: "ec-field-name-column" }, { label: "Clave" }, { label: "Tipo", className: "ec-field-type-column" }]}
          caption="Selecciona un campo para ver sus opciones o editarlo."
          emptyMessage="Todavía no hay campos configurados. Crea el primero con «Nuevo campo»."
          rows={fields.map(field => ({
          id: field.id, label: field.label,
          cells: [<code key="key">{field.field_key}</code>, fieldTypeLabels[field.field_type] ?? field.field_type],
          details: <div className="ec-template-detail-heading">
            <div className="ec-template-description">
              <h2 className="ec-h3">Opciones del campo</h2>
              <p className="ec-muted">{field.options?.length ? field.options.join(", ") : "Sin opciones configuradas."}</p>
              <p className="ec-help">La obligatoriedad se configura al asignar este campo a cada ficha.</p>
            </div>
            <div className="ec-actions ec-template-detail-tools">
              <EditFieldForm field={{
                id: field.id, fieldKey: field.field_key, label: field.label,
                fieldType: field.field_type, isRequired: false, options: field.options ?? []
              }} />
            </div>
          </div>
        }))} />
      </section>
    </div>
  );
}
