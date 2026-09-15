"use client";

import { useState } from "react";
import type { InventoryTemplateDefinition } from "@/lib/inventory/templates";
import { canPrefillField, compatibleFactValue, factLabels, productProviders, suggestedProductValues,
  validProductCode, type ProductCandidate, type ProductDraft, type ProductProvider } from "@/lib/inventory/product-research";
import { researchProduct } from "./product-research-action";

export function ProductResearch({ code, site, templates, canCreate, onDraft, disabled }: {
  code: string; site: string; templates: InventoryTemplateDefinition[]; canCreate: boolean;
  onDraft: (draft: ProductDraft) => void; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ProductProvider>("upcitemdb");
  const [candidate, setCandidate] = useState<ProductCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  async function search() {
    setOpen(true); setBusy(true); setCandidate(null); setMessage(""); setFailed(false);
    try {
      const result = await researchProduct({ code, site, provider });
      setCandidate(result.candidate ?? null); setFailed(!!result.error); setRevision(value => value + 1);
      setMessage(result.error ?? (result.notFound ? "No hay una coincidencia inequívoca para este código en este catálogo. Prueba otro catálogo o continúa manualmente." : ""));
    } catch { setFailed(true); setMessage("La consulta no se ha podido completar. Puedes continuar con el alta manual."); }
    finally { setBusy(false); }
  }

  return <section className="ec-product-research ec-stack" aria-label="Datos externos del producto">
    <div className="ec-row-wrap">
      <button type="button" className="ec-btn" disabled={disabled || busy} onClick={() => setOpen(value => !value)} aria-expanded={open}>
        {open ? "Ocultar búsqueda online" : "Buscar producto en internet"}
      </button>
      <span className="ec-help">Opcional · borrador sujeto a revisión</span>
    </div>
    {open && <>
      <p className="ec-help">De tu inventario solo se envía el código al catálogo elegido, no la sede, existencias ni el usuario. Open Food Facts recibe además el correo técnico configurado para identificar la aplicación. Los resultados pueden ser incompletos o incorrectos.</p>
      <div className="ec-row-wrap">
        <label className="ec-label">Catálogo<select className="ec-select" value={provider} disabled={busy || disabled} onChange={event => { setProvider(event.target.value as ProductProvider); setCandidate(null); setMessage(""); }}>
          <option value="upcitemdb">Productos generales · UPCitemdb</option>
          <option value="openfoodfacts">Alimentos · Open Food Facts</option>
        </select></label>
        <button type="button" className="ec-btn ec-btn-primary" disabled={busy || disabled || !validProductCode(code)} onClick={() => void search()}>{busy ? "Consultando..." : "Consultar código"}</button>
      </div>
      {!validProductCode(code) && <p className="ec-help">Este no es un EAN/UPC/GTIN válido. Puedes usar el código interno para dar de alta el material manualmente.</p>}
      {message && <p role={failed ? "alert" : "status"} className={failed ? "ec-error" : "ec-help"}>{message}</p>}
      {candidate && <>
        <div className="ec-row-wrap"><strong>{candidate.facts.find(fact => fact.key === "name")?.value}</strong>
          <a className="ec-link-strong" href={candidate.url} target="_blank" rel="noopener noreferrer">Fuente: {productProviders[candidate.provider]}</a>
        </div>
        <p className="ec-help">Código coincidente: {candidate.code}. Es información de un catálogo externo, no una certificación del fabricante.</p>
        <dl className="ec-product-facts">{candidate.facts.map(fact => <div key={fact.key}><dt>{factLabels[fact.key]}</dt><dd>{fact.value}</dd></div>)}</dl>
        {candidate.provider === "openfoodfacts" && <p className="ec-help">Datos de Open Food Facts, base bajo <a href="https://world.openfoodfacts.org/terms-of-use" target="_blank" rel="noopener noreferrer">ODbL</a>. Comprueba los ingredientes y alérgenos en el envase.</p>}
        {canCreate && templates.length > 0
          ? <DraftMapping key={revision} candidate={candidate} templates={templates} onDraft={onDraft} disabled={disabled}/>
          : <p className="ec-help">{canCreate ? "No hay fichas configuradas. Solicita una a administración antes de crear el artículo." : "Puedes consultar estos datos y solicitar su catalogación a logística. Tu rol no permite crear artículos."}</p>}
      </>}
      <p className="ec-help">La búsqueda tiene cuotas limitadas y no cubre todos los productos. No se importan fotos, PDF ni manuales automáticamente.</p>
      <a className="ec-link-strong" href={`https://www.google.com/search?q=${encodeURIComponent(`"${code}" fabricante ficha técnica manual`)}`} target="_blank" rel="noopener noreferrer">Buscar fabricante o manual en otra pestaña</a>
    </>}
  </section>;
}

function DraftMapping({ candidate, templates, onDraft, disabled }: {
  candidate: ProductCandidate; templates: InventoryTemplateDefinition[]; onDraft: (draft: ProductDraft) => void; disabled: boolean;
}) {
  const [templateCode, setTemplateCode] = useState(templates[0].code);
  const template = templates.find(value => value.code === templateCode);
  const [values, setValues] = useState(() => suggestedProductValues(templates[0], candidate));
  const [reviewed, setReviewed] = useState(false);
  return <div className="ec-stack">
    <label className="ec-label">Preparar con la ficha<select className="ec-select" disabled={disabled} value={templateCode} onChange={event => {
      const next = templates.find(value => value.code === event.target.value)!;
      setTemplateCode(next.code); setValues(suggestedProductValues(next, candidate)); setReviewed(false);
    }}>{templates.map(value => <option key={value.code} value={value.code}>{value.name}</option>)}</select></label>
    <p className="ec-help">Elige qué datos trasladar. Los campos sin sugerencia se completan en el formulario. Nunca se rellenan stock, unidades por envase, caducidad, lote, número de serie ni ubicación.</p>
    <div className="ec-product-mapping">{template?.fields.filter(canPrefillField).map(field => <label className="ec-label" key={field.key}>
      <span>{field.label}</span>
      <select className="ec-select" disabled={disabled} value={values[field.key] ?? ""} onChange={event => { setValues(previous => ({ ...previous, [field.key]: event.target.value })); setReviewed(false); }}>
        <option value="">Completar manualmente</option>
        {candidate.facts.map(fact => { const value = compatibleFactValue(field, fact); return value ? <option key={fact.key} value={value}>{factLabels[fact.key]}: {value.slice(0, 120)}</option> : null; })}
      </select>
    </label>)}</div>
    <label className="ec-checkbox"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={event => setReviewed(event.target.checked)}/>He comprobado que es el producto correcto y he revisado los datos seleccionados.</label>
    <button type="button" className="ec-btn ec-btn-primary" disabled={!reviewed || disabled || !template} onClick={() => {
      const variantValue = (key: "brand" | "model") => { const value = candidate.facts.find(fact => fact.key === key)?.value ?? ""; return value.length <= 80 ? value : ""; };
      if (template) onDraft({ templateCode: template.code, values, variant: { brand: variantValue("brand"), model: variantValue("model") }, source: { provider: candidate.provider, code: candidate.code, fetchedAt: candidate.fetchedAt, reviewed: true } });
    }}>Usar borrador en el formulario</button>
  </div>;
}
