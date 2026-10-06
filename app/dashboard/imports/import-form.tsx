"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { confirmUniformity, previewUniformity, type ImportState } from "./actions";

type Destination = { id: string; name: string; headquarters_id: string };
function Confirmation({ draftId, sites, locations, containers }: {
  draftId: string; sites: { id: string; name: string }[]; locations: Destination[]; containers: Destination[];
}) {
  const [state, action, pending] = useActionState<{ error?: string; success?: string }, FormData>(confirmUniformity, {});
  const [site, setSite] = useState("");
  const [type, setType] = useState("none");
  return state.success ? <div className="ec-stack"><p className="ec-success" role="status">{state.success}</p><Link className="ec-btn" href="/dashboard/inventory?category=uniformidad">Ver uniformidad</Link></div> :
    <form action={action} className="ec-stack"><fieldset disabled={pending} className="ec-stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <input type="hidden" name="draftId" value={draftId} />
      <div className="ec-form-grid">
        <label className="ec-label">Sede<select required className="ec-select" name="site" value={site} onChange={event => setSite(event.target.value)}>
          <option value="">Selecciona la sede del stock</option>{sites.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}
        </select></label>
        <label className="ec-label">Destino<select className="ec-select" name="destination" value={type} onChange={event => setType(event.target.value)}>
          <option value="none">Sin ubicación asignada</option><option value="location">Ubicación física</option><option value="container">Caja / kit</option>
        </select></label>
        {type !== "none" && <label className="ec-label">{type === "location" ? "Ubicación" : "Caja"}<select key={`${site}-${type}`} required name="destinationId" className="ec-select" defaultValue="">
          <option value="">Selecciona un destino</option>{(type === "location" ? locations : containers).filter(d => d.headquarters_id === site).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>}
      </div>
      <label className="ec-checkbox"><input type="checkbox" name="availableStock" required />Confirmo que son existencias disponibles, sin incluir ropa ya entregada, y he revisado la sede y las cantidades.</label>
      <p className="ec-help">Carga inicial: no sustituye ni suma cantidades sobre artículos importados previamente. Un error cancela toda la carga.</p>
      {state.error && <p role="alert" className="ec-error">{state.error}</p>}
      <button className="ec-btn ec-btn-primary" disabled={pending} type="submit">{pending ? "Importando…" : "Confirmar importación"}</button>
    </fieldset></form>;
}

export function UniformityImportForm(props: { sites: { id: string; name: string }[]; locations: Destination[]; containers: Destination[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(previewUniformity, {});
  return <div className="ec-stack">
    <form action={action} className="ec-row ec-row-wrap">
      <label className="ec-label">Excel de uniformidad / CSV<input className="ec-input" name="file" type="file" accept=".xlsx,.csv" required disabled={pending} /></label>
      <button type="submit" className="ec-btn" disabled={pending}>{pending ? "Analizando…" : "Analizar archivo"}</button>
    </form>
    <p className="ec-help">Vacío = esa talla no existe para la prenda. Cero = talla existente sin stock. No se crean usuarios ni se envían correos al importar ropa.</p>
    <details><summary className="ec-help">Formatos admitidos</summary><p className="ec-help">Excel con bloques PRIMERA UNIFORMIDAD / SEGUNDA UNIFORMIDAD y columnas XS, S, M, L, XL, XXL, SIN TALLA. También tabla Excel o CSV UTF-8 con columnas UNIFORMIDAD, PRENDA, TALLA, CANTIDAD. No se admiten subtotales ni filas duplicadas.</p></details>
    {state.error && <p className="ec-error" role="alert">{state.error}</p>}
    {!pending && state.preview && state.draftId && <>
      <div className="ec-row ec-row-wrap"><strong>{state.filename}</strong><span className="ec-badge ec-badge-neutral">{state.preview.garments} fichas</span><span>{state.preview.rows.length} artículos por talla · {state.preview.total} unidades</span></div>
      <p className="ec-help">{state.preview.omitted} celdas vacías omitidas. Se creará Uniformidad con Primera uniformidad y Segunda uniformidad.</p>
      <div className="ec-table-wrap" style={{ maxHeight: 360, overflow: "auto" }}><table className="ec-table">
        <caption className="ec-help">Vista previa completa; todavía no se ha modificado el stock.</caption>
        <thead><tr><th>Uniformidad</th><th>Prenda</th><th>Talla</th><th>Stock</th><th>Origen</th></tr></thead>
        <tbody>{state.preview.rows.map(row => <tr key={`${row.section}-${row.garment}-${row.size}`}><td>{row.section === "first" ? "Primera" : "Segunda"}</td><td>{row.garment}</td><td>{row.size}</td><td>{row.quantity}</td><td>{row.source}</td></tr>)}</tbody>
      </table></div>
      <Confirmation key={state.draftId} draftId={state.draftId} {...props} />
    </>}
  </div>;
}
