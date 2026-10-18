"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { newChecklistId } from "../checklists/id";
import { useActionState } from "react";
import { createInventoryItem } from "@/app/dashboard/actions";
import type { InventoryTemplateDefinition } from "@/lib/inventory/templates";

type HeadquartersOption = {
  id: string;
  name: string;
};

type PlacementOption = {
  id: string;
  name: string;
  headquarters_id?: string | null;
};

export function CreateInventoryItemForm({
  canChooseHeadquarters,
  containers,
  headquarters,
  locations,
  templates,
  categories,
  initialCategoryCode,
  initialHeadquartersId,
  userHeadquartersId,
  onCreated,
  draftKey,
  onBusy
}: {
  canChooseHeadquarters: boolean;
  containers: PlacementOption[];
  headquarters: HeadquartersOption[];
  locations: PlacementOption[];
  templates: InventoryTemplateDefinition[];
  categories?: { code: string; name: string }[];
  initialCategoryCode?: string;
  initialHeadquartersId?: string;
  userHeadquartersId: string | null;
  onCreated?: (id: string, name: string) => void;
  draftKey?: string;
  onBusy?: (busy: boolean) => void;
}) {
  const receivingId = useRef<string | null>(null);
  const submitted = useRef<FormData | null>(null);
  const [creationUncertain,setCreationUncertain] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: Awaited<ReturnType<typeof createInventoryItem>> | undefined, form: FormData) => {
    if (onCreated) {
      receivingId.current ??= newChecklistId();
      form.set("receivingId",receivingId.current);
      if (selectedTemplate?.fields.some(field => field.key === "current_stock")) form.set("templateField_current_stock","0");
      else form.delete("templateField_current_stock");
      form = submitted.current ?? form;
      submitted.current = form;
      if(draftKey)try{sessionStorage.setItem(draftKey,JSON.stringify([...form.entries()]));}catch{}
    }
    try {
      const result = await createInventoryItem(previous,form);
      if (onCreated && "itemId" in result && result.itemId) {
        if(draftKey)try{sessionStorage.removeItem(draftKey);}catch{}
        onCreated(result.itemId,result.itemName);
      }
      // Keep the exact payload on errors too: a transport failure can arrive as an API error.
      if (onCreated && result.error) {
        const uncertain="retry" in result && !!result.retry;
        setCreationUncertain(uncertain);
        if(!uncertain) {
          submitted.current=null;
          if(draftKey)try{sessionStorage.removeItem(draftKey);}catch{}
        }
      }
      return result;
    } catch {
      if (onCreated) setCreationUncertain(true);
      return {error:"Respuesta no confirmada. Reintenta sin modificar los datos."};
    }
  }, undefined);
  useEffect(()=>{
    if(!draftKey)return;
    try {
      const entries=JSON.parse(sessionStorage.getItem(draftKey)??"null");
      if(!Array.isArray(entries)||!entries.every(e=>Array.isArray(e)&&e.length===2&&typeof e[0]==="string"&&typeof e[1]==="string"))return;
      const form=new FormData();for(const [key,value] of entries)form.append(key,value);
      const id=String(form.get("receivingId")??"");
      if(!/^[0-9a-f-]{36}$/.test(id))return;
      receivingId.current=id;submitted.current=form;setCreationUncertain(true);
    }catch{}
  },[draftKey]);
  useEffect(()=>{onBusy?.(pending||creationUncertain);return()=>onBusy?.(false);},[pending,creationUncertain,onBusy]);
  const categoryOptions = categories ?? Array.from(new Map(templates.map(template => [template.category,
    { code: template.category, name: template.categoryName ?? template.category }])).values());
  const startingCategory = initialCategoryCode ?? templates[0]?.category ?? "";
  const [selectedCategory, setSelectedCategory] = useState(startingCategory);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState(templates.find(template => template.category === startingCategory)?.code ?? "");
  const [placementType, setPlacementType] = useState<"none" | "location" | "container">("none");
  const [selectedHeadquarters, setSelectedHeadquarters] = useState(canChooseHeadquarters ? initialHeadquartersId ?? userHeadquartersId ?? "" : userHeadquartersId ?? "");
  const visibleTemplates = templates.filter(template => template.category === selectedCategory);
  const selectedTemplate = visibleTemplates.find((template) => template.code === selectedTemplateCode);
  const visibleLocations = locations.filter(option => option.headquarters_id === selectedHeadquarters);
  const visibleContainers = containers.filter(option => option.headquarters_id === selectedHeadquarters);

  if (!templates.length) {
    return (
      <div className="ec-stack">
        <p className="ec-muted">
          Todavía no hay plantillas de producto configuradas. Un administrador debe crear una y asignarle los campos.
        </p>
        {canChooseHeadquarters && <Link className="ec-btn" href="/dashboard/templates">Configurar plantillas</Link>}
      </div>
    );
  }

  return (
    <form action={formAction} className="ec-stack">
      {onCreated && <p className="ec-help">Alta de catálogo sin existencias. Después se asociará el código y un administrador confirmará la entrada.</p>}
      <fieldset className="ec-stack ec-receiving-fieldset" disabled={pending || creationUncertain}>
      <input name="templateCode" type="hidden" value={selectedTemplate?.code ?? ""} />
      <input name="category" type="hidden" value={selectedTemplate?.category ?? selectedCategory} />
      {!canChooseHeadquarters ? (
        <input name="headquartersId" type="hidden" value={userHeadquartersId ?? ""} />
      ) : null}

      <div className="ec-form-grid">
      {canChooseHeadquarters ? (
        <label className="ec-label">
          <span>Sede</span>
          <select className="ec-select" name="headquartersId" value={selectedHeadquarters} onChange={event => { setSelectedHeadquarters(event.target.value); setPlacementType("none"); }} required>
            <option value="">Selecciona una sede</option>
            {headquarters.map((headquarter) => (
              <option key={headquarter.id} value={headquarter.id}>
                {headquarter.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="ec-label">Categoría / subcategoría
        <select className="ec-select" value={selectedCategory} name="categorySelector" required onChange={event => {
          setSelectedCategory(event.target.value);
          setSelectedTemplateCode(templates.find(template => template.category === event.target.value)?.code ?? "");
        }}>
          <option value="">Selecciona una categoría</option>
          {selectedCategory && !categoryOptions.some(category => category.code === selectedCategory) && <option value={selectedCategory}>Categoría no disponible</option>}
          {categoryOptions.map(category => <option key={category.code} value={category.code}>{category.name}</option>)}
        </select>
      </label>
      <label className="ec-label">
        <span>Plantilla de campos</span>
        <select
          className="ec-select"
          name="templateCodeSelector"
          onChange={(event) => setSelectedTemplateCode(event.target.value)}
          value={selectedTemplate?.code ?? ""}
          required
          disabled={!visibleTemplates.length}
        >
          {!selectedTemplate && <option value="">Sin plantilla en esta categoría</option>}
          {visibleTemplates.map(template => <option key={template.code} value={template.code}>{template.name}</option>)}
        </select>
      </label>

      </div>
      {!selectedTemplate && <p className="ec-error" role="alert">Esta categoría no tiene una plantilla disponible. No se creará el artículo en otra categoría.
        {canChooseHeadquarters ? <> <Link href={`/dashboard/templates?category=${encodeURIComponent(selectedCategory)}`} target="_blank">Configurar plantilla</Link>. Cierra y vuelve a abrir este formulario para cargar los cambios.</> : " Pide a un administrador que configure sus campos."}
      </p>}
      {selectedTemplate ? <p className="ec-help">{selectedTemplate.description}</p> : null}

      <section className="ec-template-fields ec-item-fields" key={selectedTemplate?.code}>
        <div className="ec-col">
          <h3 className="ec-h3">Datos del artículo</h3>
          <div className="ec-help">
            Completa los campos de la plantilla seleccionada. Los marcados con * son obligatorios.
          </div>
        </div>

        {selectedTemplate?.fields?.length ? (
          selectedTemplate.fields.map((field) => {
            const inputName = `templateField_${field.key}`;
            if (onCreated && field.key === "current_stock") return <input key={field.key} name={inputName} type="hidden" value="0" />;

            if (field.type === "textarea") {
              return (
                <label className="ec-label ec-item-long-field" key={field.key}>
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  <textarea
                    className="ec-textarea"
                    name={inputName}
                    placeholder={field.placeholder}
                    required={field.required}
                    rows={3}
                  />
                </label>
              );
            }

            if (field.type === "select") {
              return (
                <label className="ec-label" key={field.key}>
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  <select className="ec-select" name={inputName} required={field.required}>
                    <option value="">Selecciona</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }

            if (field.type === "boolean") {
              return (
                <label className="ec-checkbox" key={field.key}>
                  <input name={inputName} type="checkbox" value="true" />
                  <span>{field.label}{field.required ? " *" : ""}</span>
                </label>
              );
            }

            return (
              <label className="ec-label" key={field.key}>
                <span>{field.label}{field.required ? " *" : ""}</span>
                  <input
                  step={field.type === "number" ? "0.001" : undefined}
                  className="ec-input"
                  name={inputName}
                  placeholder={field.placeholder}
                  required={field.required}
                  type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                />
              </label>
            );
          })
        ) : (
          <div className="ec-help">Esta ficha no tiene campos configurados todavia.</div>
        )}
      </section>
      {!onCreated && <section className="ec-template-fields">
        <div className="ec-col">
          <h3 className="ec-h3">Ubicación inicial</h3>
          <div className="ec-help">
            El stock inicial va a una ubicación o caja. Después puedes repartirlo entre varios destinos desde la ficha.
          </div>
        </div>

        <label className="ec-label">
          <span>Dónde va</span>
          <select
            className="ec-select"
            name="placementType"
            onChange={(event) => setPlacementType(event.target.value as "none" | "location" | "container")}
            value={placementType}
          >
            <option value="none">Sin ubicación por ahora</option>
            <option value="location">Ubicación física</option>
            <option value="container">Caja / kit</option>
          </select>
        </label>

        {placementType === "location" ? (
          <label className="ec-label">
            <span>Ubicación física</span>
            <select className="ec-select" name="locationId" required>
              <option value="">Selecciona ubicación</option>
              {visibleLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {placementType === "container" ? (
          <>
            <label className="ec-label">
              <span>Caja</span>
              <select className="ec-select" name="containerId" required>
                <option value="">Selecciona caja</option>
                {visibleContainers.map((container) => (
                  <option key={container.id} value={container.id}>
                    {container.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ec-form-grid">
              <p className="ec-help">El stock inicial se guardará aquí. Después podrás repartir cantidades desde Existencias y ubicaciones, sin crear más artículos.</p>
              <label className="ec-label">
                <span>Notas</span>
                <input className="ec-input" name="containerNotes" placeholder="Ej. compartimento interior" />
              </label>
            </div>
          </>
        ) : null}
      </section>}

      </fieldset>

      {state?.error ? <p className="ec-error">{state.error}</p> : null}
      {creationUncertain && <p className="ec-help">Hay un alta sin confirmar. Se reenviarán los datos originales guardados, no los campos que se muestran ahora.</p>}
      {state?.success ? <p className="ec-success">{state.success}</p> : null}

      <button className="ec-btn ec-btn-primary ec-btn-block" type="submit" disabled={pending || (!selectedTemplate && !creationUncertain)}>
        {pending ? "Guardando..." : creationUncertain ? "Reintentar la misma alta" : "Crear artículo"}
      </button>
    </form>
  );
}
