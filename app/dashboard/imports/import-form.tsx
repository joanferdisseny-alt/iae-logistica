"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { confirmUniformity, previewUniformity, type ImportState } from "./actions";

type Destination = { id: string; name: string; headquarters_id: string };
function Confirmation({ draftId, sites, locations, containers, onBack, onComplete }: {
  draftId: string; sites: { id: string; name: string }[]; locations: Destination[]; containers: Destination[];
  onBack: () => void; onComplete: () => void;
}) {
  const [state, action, pending] = useActionState<{ error?: string; success?: string }, FormData>(async (previous, form) => {
    try {
      const result = await confirmUniformity(previous, form);
      if (result.success) onComplete();
      return result;
    } catch { return { error: "No se ha confirmado la respuesta. Reintenta esta misma importación para comprobarla sin duplicar existencias." }; }
  }, {});
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
      <div className="ec-actions"><button className="ec-btn" type="button" disabled={pending} onClick={onBack}>Volver a la revisión</button><button className="ec-btn ec-btn-primary" disabled={pending} type="submit">{pending ? "Importando…" : "Confirmar e importar stock"}</button></div>
    </fieldset></form>;
}

export function UniformityImportForm(props: { sites: { id: string; name: string }[]; locations: Destination[]; containers: Destination[] }) {
  const [step, setStep] = useState(0);
  const [state, action, pending] = useActionState<ImportState, FormData>(async (previous, form) => {
    try {
      const result = await previewUniformity(previous, form);
      if (result.preview && result.draftId) setStep(1);
      return result;
    } catch { return { error: "No se ha podido analizar el archivo. Comprueba la conexión y vuelve a intentarlo." }; }
  }, {});
  return <div className="ec-stack">
    <ol className="ec-import-steps" aria-label="Pasos de la importación">{["Archivo", "Revisión", "Sede y destino", "Resultado"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={step > index ? "is-complete" : ""}><span>{index + 1}</span>{label}</li>)}</ol>
    {step === 0 && <section className="ec-import-upload ec-stack">
    <div><h2 className="ec-h2">Carga inicial de uniformidad</h2><p className="ec-muted">El archivo creará las categorías y una ficha por prenda, con sus tallas y cantidades dentro. Primero podrás revisarlo: todavía no se modifica el inventario.</p></div>
    <form action={action} className="ec-stack">
      <label className="ec-label">Excel de uniformidad / CSV<input className="ec-input" name="file" type="file" accept=".xlsx,.csv" required disabled={pending} /></label>
      <div className="ec-actions"><button type="submit" className="ec-btn ec-btn-primary" disabled={pending}>{pending ? "Analizando…" : "Continuar: revisar archivo"}</button><a className="ec-btn" href="/plantilla-uniformidad.csv" download>Descargar ejemplo CSV</a></div>
    </form>
    <p className="ec-help">El CSV de ejemplo contiene datos ficticios. Sustituye las prendas y cantidades antes de importarlo.</p>
    <p className="ec-help">Archivos .xlsx o .csv de hasta 1 MB. Este asistente importa uniformidad, no otros tipos de material ni ropa ya entregada. Para una entrada posterior de material utiliza <Link href="/dashboard/receiving">Recibir material</Link>.</p>
    <p className="ec-help">Vacío = esa talla no existe para la prenda. Cero = talla existente sin stock. No se crean usuarios ni se envían correos al importar ropa.</p>
    <details><summary className="ec-help">Formatos admitidos</summary><p className="ec-help">Excel con bloques PRIMERA UNIFORMIDAD / SEGUNDA UNIFORMIDAD y columnas XS, S, M, L, XL, XXL, SIN TALLA. También tabla Excel o CSV UTF-8 con columnas UNIFORMIDAD, PRENDA, TALLA, CANTIDAD. No se admiten subtotales ni filas duplicadas.</p></details>
    {state.error && <p className="ec-error" role="alert">{state.error}</p>}
    </section>}
    {step > 0 && state.preview && state.draftId && <>
      <div className="ec-row ec-row-wrap"><strong>{state.filename}</strong><span className="ec-badge ec-badge-neutral">{state.preview.garments} fichas de prenda</span><span>{state.preview.rows.length} variantes de talla · {state.preview.total} unidades</span></div>
      {step === 1 && <>
      <p className="ec-help">{state.preview.omitted} celdas vacías omitidas. Se creará Uniformidad con Primera uniformidad y Segunda uniformidad.</p>
      <div className="ec-table-wrap" style={{ maxHeight: 360, overflow: "auto" }}><table className="ec-table">
        <caption className="ec-help">Vista previa completa; todavía no se ha modificado el stock.</caption>
        <thead><tr><th>Uniformidad</th><th>Prenda</th><th>Talla</th><th>Stock</th><th>Origen</th></tr></thead>
        <tbody>{state.preview.rows.map(row => <tr key={`${row.section}-${row.garment}-${row.size}`}><td>{row.section === "first" ? "Primera" : "Segunda"}</td><td>{row.garment}</td><td>{row.size}</td><td>{row.quantity}</td><td>{row.source}</td></tr>)}</tbody>
      </table></div>
      <div className="ec-actions"><button type="button" className="ec-btn" onClick={() => setStep(0)}>Elegir otro archivo</button><button type="button" className="ec-btn ec-btn-primary" onClick={() => setStep(2)}>Continuar: sede y destino</button></div>
      </>}
      {step >= 2 && <Confirmation key={state.draftId} draftId={state.draftId} {...props} onBack={() => setStep(1)} onComplete={() => setStep(3)} />}
    </>}
  </div>;
}
