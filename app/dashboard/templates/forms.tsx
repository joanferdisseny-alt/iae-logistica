"use client";
import { DialogFocus } from "@/app/dashboard/dialog-focus";
import { ActionForm } from "@/app/dashboard/action-form";
import Link from "next/link";

import { useActionState, useState, type ReactNode } from "react";
import {
  addFieldToTemplate,
  createInventoryCategory,
  createInventoryTemplate,
  createInventoryTemplateField,
  deleteInventoryCategory,
  deleteInventoryTemplate,
  deleteInventoryTemplateField,
  removeFieldFromTemplate,
  updateInventoryCategory,
  updateInventoryTemplate,
  updateInventoryTemplateField
} from "@/app/dashboard/actions";

type CategoryOption = {
  code: string;
  name: string;
};


type TemplateTarget = {
  id: string;
  name: string;
};

type FieldOption = {
  id: string;
  fieldKey: string;
  label: string;
};

type CategoryRecord = {
  code: string;
  name: string;
  description: string | null;
  parent_code: string | null;
};

type TemplateRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  categoryCode: string;
};

type TemplateFieldRecord = {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: "text" | "number" | "date" | "textarea" | "select" | "boolean";
  isRequired: boolean;
  options: string[];
};

function CategoryParentSelect({ categories, value = "" }: { categories: CategoryOption[]; value?: string }) {
  return <label className="ec-label">
    <span>Categoría superior</span>
    <select className="ec-select" name="parentCode" defaultValue={value}>
      <option value="">Ninguna (categoría principal)</option>
      {categories.map(category => <option key={category.code} value={category.code}>{category.name}</option>)}
    </select>
    <span className="ec-help">Selecciona una categoría para crear una subcategoría dentro de ella.</span>
  </label>;
}

function NameAndCodeFields({ placeholder }: { placeholder: string }) {
  const [name, setName] = useState("");
  const [customCode, setCustomCode] = useState<string | null>(null);
  const automaticCode = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return <>
    <label className="ec-label">Nombre<input className="ec-input" name="name" placeholder={placeholder} value={name} onChange={event => setName(event.target.value)} required /></label>
    <label className="ec-label">Código interno<input className="ec-input" name="code" value={customCode ?? automaticCode} onChange={event => setCustomCode(event.target.value)} required />
      <span className="ec-help">Se genera a partir del nombre. Puedes cambiarlo antes de guardar; debe ser único.</span>
    </label>
  </>;
}

export function CreateCategoryForm({ categories, parentCode }: { categories: CategoryOption[]; parentCode?: string }) {
  const [state, formAction, pending] = useActionState(createInventoryCategory, undefined);

  return (
    <form action={formAction} className="ec-stack">
      <NameAndCodeFields placeholder="Herramienta eléctrica" />
      <CategoryParentSelect categories={categories} value={parentCode} />
      <label className="ec-label">
        <span>Descripción</span>
        <textarea className="ec-textarea" name="description" rows={3} />
      </label>
      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}
      <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
        {pending ? "Guardando..." : "Crear categoría"}
      </button>
    </form>
  );
}

export function CreateCategoryModal({ categories, parentCode }: { categories: CategoryOption[]; parentCode?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className={`ec-btn ${parentCode ? "" : "ec-btn-primary"}`} onClick={() => setOpen(true)} type="button">
        {parentCode ? "Añadir subcategoría" : "Nueva categoría"}
      </button>

      <ModalShell kicker="Categorías" open={open} setOpen={setOpen} title={parentCode ? "Crear subcategoría" : "Crear categoría"}>
        <CreateCategoryForm categories={categories} parentCode={parentCode} />
      </ModalShell>
    </>
  );
}

export function CreateTemplateForm({ categories }: { categories: CategoryOption[] }) {
  const [state, formAction, pending] = useActionState(createInventoryTemplate, undefined);

  return (
    <form action={formAction} className="ec-stack">
      <NameAndCodeFields placeholder="Taladro a batería" />
      <label className="ec-label">
        <span>Categoría</span>
        <select className="ec-select" defaultValue="" name="categoryCode" required>
          <option disabled value="">
            Selecciona una categoría
          </option>
          {categories.map((category) => (
            <option key={category.code} value={category.code}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ec-label">
        <span>Descripción</span>
        <textarea className="ec-textarea" name="description" rows={3} />
      </label>
      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}
      <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
        {pending ? "Guardando..." : "Crear tipo de artículo"}
      </button>
    </form>
  );
}

export function CreateTemplateModal({ categories }: { categories: CategoryOption[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn ec-btn-primary" onClick={() => setOpen(true)} type="button">
        Nuevo tipo
      </button>

      <ModalShell kicker="Catálogo" open={open} setOpen={setOpen} title="Crear tipo de artículo">
        <p className="ec-help">Define el nombre y la categoría. Después selecciona el tipo en la tabla y pulsa «Añadir campo» para configurar su ficha.</p>
        <CreateTemplateForm categories={categories} />
      </ModalShell>
    </>
  );
}

export function CreateFieldForm() {
  const [state, formAction, pending] = useActionState(createInventoryTemplateField, undefined);

  return (
    <form action={formAction} className="ec-stack">
      <label className="ec-label">
        <span>Clave</span>
        <input className="ec-input" name="fieldKey" placeholder="diametro" required />
      </label>
      <label className="ec-label">
        <span>Etiqueta</span>
        <input className="ec-input" name="label" placeholder="Diámetro" required />
      </label>
      <label className="ec-label">
        <span>Tipo</span>
        <select className="ec-select" defaultValue="text" name="fieldType">
          <option value="text">Texto</option>
          <option value="number">Número</option>
          <option value="date">Fecha</option>
          <option value="textarea">Texto largo</option>
          <option value="select">Selección</option>
          <option value="boolean">Sí / no</option>
        </select>
      </label>
      <label className="ec-label">
        <span>Opciones (coma separada, si es selección)</span>
        <input className="ec-input" name="options" placeholder="madera,metal,hormigon" />
      </label>
      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}
      <button className="ec-btn ec-btn-primary ec-btn-block" disabled={pending} type="submit">
        {pending ? "Guardando..." : "Añadir campo"}
      </button>
    </form>
  );
}

export function CreateFieldModal({ template }: { template: TemplateTarget }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn ec-btn-primary" onClick={() => setOpen(true)} type="button">
        Anadir campo
      </button>

      <ModalShell kicker="Campos" open={open} setOpen={setOpen} title={`Anadir campo a ${template.name}`}>
        <p className="ec-help">
          Este flujo ahora vive en la asignacion de campos desde la ficha.
        </p>
      </ModalShell>
    </>
  );
}

export function CreateFieldCatalogModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn ec-btn-primary" onClick={() => setOpen(true)} type="button">
        Nuevo campo
      </button>

      <ModalShell kicker="Campos" open={open} setOpen={setOpen} title="Crear campo">
        <CreateFieldForm />
      </ModalShell>
    </>
  );
}

export function AssignFieldToTemplateModal({
  fields,
  template
}: {
  fields: FieldOption[];
  template: TemplateTarget;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addFieldToTemplate, undefined);

  return (
    <>
      <button className="ec-btn ec-btn-primary" onClick={() => setOpen(true)} type="button">
        Añadir campo
      </button>

      <ModalShell kicker="Fichas" open={open} setOpen={setOpen} title={`Añadir campo a ${template.name}`}>
        {fields.length ? <form action={formAction} className="ec-stack">
          <fieldset className="ec-stack" disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <input name="templateId" type="hidden" value={template.id} />
          <label className="ec-label">
            <span>Campo</span>
            <select className="ec-select" defaultValue="" name="fieldId" required>
              <option disabled value="">
                Selecciona un campo
              </option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label} ({field.fieldKey})
                </option>
              ))}
            </select>
          </label>
          <label className="ec-checkbox">
            <input name="isRequired" type="checkbox" value="true" />
            <span>Marcar como obligatorio en esta ficha</span>
          </label>
          {state?.error ? <p className="ec-error" role="alert">{state.error}</p> : null}
          {state?.success ? <p className="ec-success" role="status">{state.success}</p> : null}
          <button className="ec-btn ec-btn-primary" disabled={pending} type="submit">
            {pending ? "Guardando..." : "Añadir a la ficha"}
          </button>
          </fieldset>
        </form> : <div className="ec-stack">
          {state?.success && <p className="ec-success" role="status">{state.success}</p>}
          <p className="ec-help">No quedan campos disponibles para esta ficha. Puedes crear uno nuevo en el catálogo.</p>
          <Link className="ec-btn" href="/dashboard/templates/fields">Ir al catálogo de campos</Link>
        </div>}
      </ModalShell>
    </>
  );
}

function ModalShell({
  children,
  kicker,
  open,
  setOpen,
  title
}: {
  children: ReactNode;
  kicker: string;
  open: boolean;
  setOpen: (value: boolean) => void;
  title: string;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="ec-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
      <div
        aria-modal="true"
        className="ec-modal ec-modal-narrow"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      ><DialogFocus />
        <div className="ec-modal-header">
          <div className="ec-col">
            <div className="ec-muted-2">{kicker}</div>
            <h2 className="ec-h2">{title}</h2>
          </div>
          <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
            Cerrar
          </button>
        </div>

        <div className="ec-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function EditCategoryForm({ category, categories }: { category: CategoryRecord; categories: CategoryOption[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn" onClick={() => setOpen(true)} type="button">
        Editar
      </button>

      <ModalShell kicker="Categoría" open={open} setOpen={setOpen} title={`Editar ${category.name}`}>
        <>
          <ActionForm action={updateInventoryCategory} className="ec-stack">
            <input name="code" type="hidden" value={category.code} />
            <label className="ec-label">
              <span>Nombre</span>
              <input className="ec-input" defaultValue={category.name} name="name" required />
            </label>
            <CategoryParentSelect categories={categories} value={category.parent_code ?? ""} />
            <label className="ec-label">
              <span>Descripción</span>
              <textarea
                className="ec-textarea"
                defaultValue={category.description ?? ""}
                name="description"
                rows={3}
              />
            </label>
            <button className="ec-btn ec-btn-primary" type="submit">
              Guardar cambios
            </button>
          </ActionForm>
          <div className="ec-modal-footer">
            <DeleteCategoryForm code={category.code} />
          </div>
        </>
      </ModalShell>
    </>
  );
}

export function DeleteCategoryForm({ code }: { code: string }) {
  return (
    <ActionForm action={deleteInventoryCategory}>
      <input name="code" type="hidden" value={code} />
      <button className="ec-btn ec-btn-danger" type="submit">
        Eliminar
      </button>
    </ActionForm>
  );
}

export function EditTemplateForm({
  categories,
  template
}: {
  categories: CategoryOption[];
  template: TemplateRecord;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn" onClick={() => setOpen(true)} type="button">
        Editar
      </button>

      <ModalShell kicker="Ficha" open={open} setOpen={setOpen} title={`Editar ${template.name}`}>
        <>
          <ActionForm action={updateInventoryTemplate} className="ec-stack">
            <input name="id" type="hidden" value={template.id} />
            <label className="ec-label">
              <span>Nombre</span>
              <input className="ec-input" defaultValue={template.name} name="name" required />
            </label>
            <label className="ec-label">
              <span>Código</span>
              <input className="ec-input" defaultValue={template.code} name="code" required />
            </label>
            <label className="ec-label">
              <span>Categoría</span>
              <select className="ec-select" defaultValue={template.categoryCode} name="categoryCode">
                {categories.map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ec-label">
              <span>Descripción</span>
              <textarea
                className="ec-textarea"
                defaultValue={template.description ?? ""}
                name="description"
                rows={3}
              />
            </label>
            <button className="ec-btn ec-btn-primary" type="submit">
              Guardar cambios
            </button>
          </ActionForm>
          <div className="ec-modal-footer">
            <DeleteTemplateForm id={template.id} />
          </div>
        </>
      </ModalShell>
    </>
  );
}

export function DeleteTemplateForm({ id }: { id: string }) {
  return (
    <ActionForm action={deleteInventoryTemplate}>
      <input name="id" type="hidden" value={id} />
      <button className="ec-btn ec-btn-danger" type="submit">
        Eliminar ficha
      </button>
    </ActionForm>
  );
}

export function EditFieldForm({ field }: { field: TemplateFieldRecord }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn" onClick={() => setOpen(true)} type="button">
        Editar campo
      </button>

      <ModalShell kicker="Campo de ficha" open={open} setOpen={setOpen} title={`Editar ${field.label}`}>
        <>
          <ActionForm action={updateInventoryTemplateField} className="ec-stack">
            <input name="id" type="hidden" value={field.id} />
            <label className="ec-label">
              <span>Clave</span>
              <input className="ec-input" defaultValue={field.fieldKey} name="fieldKey" required />
            </label>
            <label className="ec-label">
              <span>Etiqueta</span>
              <input className="ec-input" defaultValue={field.label} name="label" required />
            </label>
            <label className="ec-label">
              <span>Tipo</span>
              <select className="ec-select" defaultValue={field.fieldType} name="fieldType">
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="date">Fecha</option>
                <option value="textarea">Texto largo</option>
                <option value="select">Selección</option>
                <option value="boolean">Sí / no</option>
              </select>
            </label>
            <label className="ec-label">
              <span>Opciones</span>
              <input
                className="ec-input"
                defaultValue={field.options.join(", ")}
                name="options"
                placeholder="op1, op2"
              />
            </label>
            <button className="ec-btn ec-btn-primary" type="submit">
              Guardar cambios
            </button>
          </ActionForm>
          <div className="ec-modal-footer">
            <DeleteFieldForm id={field.id} />
          </div>
        </>
      </ModalShell>
    </>
  );
}

export function DeleteFieldForm({ id }: { id: string }) {
  return (
    <ActionForm action={deleteInventoryTemplateField}>
      <input name="id" type="hidden" value={id} />
      <button className="ec-btn ec-btn-danger" type="submit">
        Eliminar
      </button>
    </ActionForm>
  );
}

export function RemoveTemplateFieldForm({ assignmentId }: { assignmentId: string }) {
  return (
    <ActionForm action={removeFieldFromTemplate}>
      <input name="assignmentId" type="hidden" value={assignmentId} />
      <button className="ec-btn ec-btn-danger" type="submit">
        Quitar
      </button>
    </ActionForm>
  );
}
