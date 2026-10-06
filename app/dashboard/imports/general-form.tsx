"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { coreImportFields, importTargets, suggestImportColumns, type ImportColumn, type ImportField, type ImportPlan } from "@/lib/inventory/import-model";
import { readGeneralImport, reviewGeneralImport, confirmGeneralImport, type FileState, type ReviewState } from "./general-actions";

type Destination = { id: string; name: string; headquarters_id: string };
type Props = { sites: { id: string; name: string }[]; locations: Destination[]; containers: Destination[]; fields: ImportField[] };
const types = { text: "Texto", textarea: "Texto largo", number: "Número", date: "Fecha", boolean: "Sí / no", select: "Opciones existentes" } as const;

function Confirm({ draftId, onBack }: { draftId: string; onBack: () => void }) {
  const [state, action, pending] = useActionState<{ error?: string; success?: boolean }, FormData>(async (previous, form) => {
    try { return await confirmGeneralImport(previous, form); }
    catch { return { error: "No se ha recibido la confirmación. Reintenta con este mismo botón: no se duplicará el stock." }; }
  }, {});
  if (state.success) return <div className="ec-stack"><p className="ec-success" role="status">Importación completada. Se han creado los artículos nuevos y sumado las entradas revisadas.</p><Link className="ec-btn ec-btn-primary" href="/dashboard/inventory">Ver inventario</Link><a className="ec-btn" href="/dashboard/imports">Otra importación</a></div>;
  return <form action={action} className="ec-stack">
    <input type="hidden" name="draftId" value={draftId} />
    <label className="ec-checkbox"><input name="confirmed" type="checkbox" required disabled={pending} />He revisado los artículos y la sede. Estas cantidades son entradas nuevas: se sumarán, no sustituirán el stock actual.</label>
    {state.error && <p className="ec-error" role="alert">{state.error}</p>}
    <div className="ec-actions"><button className="ec-btn" type="button" disabled={pending} onClick={onBack}>Volver a las columnas</button><button className="ec-btn ec-btn-primary" disabled={pending}>{pending ? "Importando…" : "Confirmar e importar"}</button></div>
    <p className="ec-help">Si otra persona cambia el catálogo o estas existencias durante la revisión, se cancelará toda la carga y tendrás que revisarla de nuevo.</p>
  </form>;
}

function Plan({ plan }: { plan: ImportPlan }) {
  const created = plan.lines.filter(line => line.action === "create").length;
  return <>
    <div className="ec-row ec-row-wrap"><span className="ec-badge ec-badge-neutral">{created} artículos nuevos</span><span>{plan.lines.length - created} reposiciones</span><span>{plan.categories.length} categorías nuevas · {plan.templates.length} tipos nuevos · {plan.fields.length} campos nuevos</span></div>
    <details><summary>Estructura que se creará o ampliará</summary><div className="ec-import-changes">{([["Categorías", plan.categories], ["Tipos de artículo", plan.templates], ["Campos", plan.fields], ["Campos añadidos a fichas", plan.assignments]] as const).map(([label, entries]) => <div key={label}><strong>{label}</strong>{entries.length ? <ul>{entries.map((entry, i) => <li key={i}>{entry}</li>)}</ul> : <p className="ec-help">Sin cambios</p>}</div>)}</div></details>
    <div className="ec-table-wrap ec-import-preview"><table className="ec-table"><caption>Revisión completa. Todavía no se ha guardado stock.</caption><thead><tr><th>Fila</th><th>Operación</th><th>Artículo / SKU</th><th>Tipo</th><th>Actual</th><th>Entrada</th><th>Resultado</th><th>Detalles</th></tr></thead><tbody>
      {plan.lines.map(line => <tr key={line.row}>
        <td className="ec-import-source">{line.row}</td><td className="ec-import-operation">{line.action === "create" ? "Crear artículo" : "Sumar stock"}</td>
        <td className="ec-import-article">{line.item_id ? <Link href={`/dashboard/inventory/${line.item_id}`} target="_blank" rel="noreferrer">{line.name}</Link> : <strong>{line.name}</strong>}<div className="ec-help">{line.sku || "Sin SKU"} · {line.details?.unit}</div></td>
        <td className="ec-import-type">{line.template}</td><td className="ec-import-amount" data-label="Actual">{line.before}</td><td className="ec-import-amount" data-label="Entrada">+{line.quantity}</td><td className="ec-import-amount" data-label="Resultado"><strong>{line.after}</strong></td>
        <td className="ec-import-details"><details><summary>Ver campos y lote</summary><p>Fila {line.row} · {line.template}</p><p>Lote: {line.lot}</p>{line.expiration && <p>Caducidad: {line.expiration}</p>}<dl>{Object.entries({ ...line.details, ...line.specs }).filter(([, value]) => value !== null && value !== "").map(([key, value]) => <div key={key}><dt>{coreImportFields[key]?.label || key}</dt><dd>{typeof value === "boolean" ? value ? "Sí" : "No" : String(value)}</dd></div>)}</dl></details></td>
      </tr>)}
    </tbody></table></div>
  </>;
}

export function GeneralImportForm({ sites, locations, containers, fields }: Props) {
  const [step, setStep] = useState(0), [columns, setColumns] = useState<ImportColumn[]>([]);
  const [site, setSite] = useState(""), [destination, setDestination] = useState("none"), [destinationId, setDestinationId] = useState(""), [reference, setReference] = useState("");
  const [file, read, reading] = useActionState<FileState, FormData>(async (previous, data) => {
    try {
      const result = await readGeneralImport(previous, data);
      if (result.table) { setColumns(suggestImportColumns(result.table.headers, fields)); setStep(1); }
      return result;
    } catch { return { error: "No se ha podido leer el archivo. Comprueba la conexión e inténtalo de nuevo." }; }
  }, {});
  const [review, prepare, preparing] = useActionState<ReviewState, FormData>(async (previous, data) => {
    try {
      const result = await reviewGeneralImport(previous, data);
      if (result.plan && result.draftId) setStep(2);
      return result;
    } catch { return { error: "No se ha podido generar la revisión. No se ha importado stock. Comprueba la conexión." }; }
  }, {});
  function updateColumn(index: number, patch: Partial<ImportColumn>) { setColumns(current => current.map((col, i) => i === index ? { ...col, ...patch } : col)); }
  return <div className="ec-stack">
    <ol className="ec-import-steps" aria-label="Importar productos">{["Archivo", "Columnas y destino", "Revisión y confirmación"].map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined} className={step > i ? "is-complete" : ""}><span>{i + 1}</span>{label}</li>)}</ol>
    {step === 0 && <section className="ec-stack ec-import-upload">
      <div><h2 className="ec-h2">Importa cualquier tipo de material</h2><p className="ec-muted">Herramientas, ropa, alimentos o consumibles. Relaciona las columnas, revisa qué se creará y confirma las entradas de stock.</p></div>
      <form action={read} className="ec-stack"><label className="ec-label">Archivo CSV / Excel<input className="ec-input" name="file" type="file" accept=".csv,.xlsx" required disabled={reading} /></label><div className="ec-actions"><button className="ec-btn ec-btn-primary" disabled={reading}>{reading ? "Leyendo…" : "Continuar: asignar columnas"}</button><a className="ec-btn" href="/plantilla-inventario.csv" download>Descargar ejemplo general</a></div></form>
      <p className="ec-help">Una fila por artículo y primera fila con cabeceras. Excel: una hoja de datos. CSV: UTF-8. Hasta 500 filas, 40 columnas y 1 MB por carga. El ejemplo contiene productos ficticios y cantidades cero.</p>
      <p className="ec-help">Usa SKU o ID para reponer con seguridad. Sin identificador se exige una coincidencia única de nombre, categoría, tipo y características; compartir categoría no basta.</p>
      {file.error && <p className="ec-error" role="alert">{file.error}</p>}
    </section>}
    {step === 1 && file.table && <form action={prepare} className="ec-stack"><fieldset className="ec-import-fieldset ec-stack" disabled={preparing}>
      <input type="hidden" name="filename" value={file.filename} /><input type="hidden" name="table" value={JSON.stringify(file.table)} /><input type="hidden" name="mapping" value={JSON.stringify(columns)} />
      <div className="ec-row ec-row-wrap"><strong>{file.filename}</strong><span>{file.table.rows.length} filas</span></div>
      <p className="ec-help">Para artículos nuevos: nombre, cantidad y categoría. SKU recomendado. Sin tipo de ficha, se reutiliza uno con los mismos campos si es único; si no existe, se crea con el nombre de la categoría final. Los campos adicionales se crean o reutilizan por su clave; los desplegables deben estar configurados previamente.</p>
      <div className="ec-table-wrap"><table className="ec-table ec-import-mapping"><thead><tr><th>Columna del archivo</th><th>Dato del inventario</th><th>Campo / tipo</th></tr></thead><tbody>{columns.map((col, index) => <tr key={index}>
        <td><strong>{file.table!.headers[index]}</strong><div className="ec-help ec-import-sample">{file.table!.rows.slice(0, 3).map(r => r[index] || "(vacío)").join(" · ")}</div></td>
        <td><select className="ec-select" aria-label={`Destino de ${file.table!.headers[index]}`} value={col.target} onChange={event => updateColumn(index, { target: event.target.value })}>{importTargets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
        <td>{col.target === "custom" ? <div className="ec-import-field-config"><input className="ec-input" aria-label={`Clave de ${file.table!.headers[index]}`} value={col.key} list="import-fields" placeholder="clave_del_campo" required pattern="[a-z][a-z0-9_]{0,59}" onChange={event => { const field = fields.find(f => f.key === event.target.value); updateColumn(index, { key: event.target.value, ...(field ? { type: field.type } : {}) }); }} /><select className="ec-select" aria-label={`Tipo de ${file.table!.headers[index]}`} value={col.type} onChange={event => updateColumn(index, { type: event.target.value as ImportColumn["type"] })}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div> : <span className="ec-help">{col.target === "ignore" ? "Se omitirá" : "Dato propio del artículo"}</span>}</td>
      </tr>)}</tbody></table></div>
      <datalist id="import-fields">{fields.filter(f => !["name", "sku", "current_stock", "unit", "lot_code", "expiration_date", "serial_number", "minimum_stock", "is_consumable", "description"].includes(f.key)).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</datalist>
      <div className="ec-form-grid">
        <label className="ec-label">Sede<select className="ec-select" name="site" required value={site} onChange={event => { setSite(event.target.value); setDestinationId(""); }}><option value="">Selecciona una sede</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="ec-label">Destino de esta entrada<select className="ec-select" name="destination" value={destination} onChange={event => { setDestination(event.target.value); setDestinationId(""); }}><option value="none">Sin ubicación asignada</option><option value="location">Ubicación física</option><option value="container">Caja / kit</option></select></label>
        {destination !== "none" && <label className="ec-label">{destination === "location" ? "Ubicación" : "Caja / kit"}<select className="ec-select" name="destinationId" required value={destinationId} onChange={event => setDestinationId(event.target.value)}><option value="">Selecciona un destino</option>{(destination === "location" ? locations : containers).filter(d => d.headquarters_id === site).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        <label className="ec-label">Referencia única de carga / albarán<input className="ec-input" name="reference" required minLength={3} maxLength={80} value={reference} onChange={event => setReference(event.target.value)} placeholder="Ej. ALBARAN-2026-001" /></label>
      </div>
      <p className="ec-help">Todas las filas entran en el destino seleccionado; el stock de otros destinos se conserva. Divide las cargas si hay varios destinos o varios lotes del mismo artículo. No incluyas existencias ya registradas ni material entregado a voluntarios. Una referencia de carga solo se admite una vez por sede.</p>
      <p className="ec-help">La caducidad se indica como AAAA-MM-DD; las cantidades admiten hasta tres decimales y no deben llevar separadores de miles. Un cero crea un artículo sin stock; una cantidad vacía se rechaza.</p>
      {review.error && <p className="ec-error" role="alert">{review.error}</p>}
      <div className="ec-actions"><button className="ec-btn" type="button" onClick={() => setStep(0)}>Cambiar archivo</button><button className="ec-btn ec-btn-primary">{preparing ? "Validando catálogo y existencias…" : "Revisar antes de importar"}</button></div>
    </fieldset></form>}
    {step === 2 && review.plan && review.draftId && <>
      <div className="ec-import-summary"><strong>{reference}</strong><span>{sites.find(s => s.id === site)?.name} · {destination === "none" ? "Sin ubicación" : (destination === "location" ? locations : containers).find(d => d.id === destinationId)?.name}</span><span>{file.filename}</span></div>
      <Plan plan={review.plan} /><Confirm key={review.draftId} draftId={review.draftId} onBack={() => setStep(1)} />
    </>}
  </div>;
}
