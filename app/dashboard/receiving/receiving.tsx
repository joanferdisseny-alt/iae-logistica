"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { InventoryTemplateDefinition } from "@/lib/inventory/templates";
import { CreateInventoryItemForm } from "../inventory/create-item-form";
import { positionLabel } from "../inventory/stock-model";
import { searchRequestArticles } from "../requests/actions";
import type { RequestArticle } from "../requests/model";
import { newChecklistId } from "../checklists/id";
import { linkBarcode, lookupBarcode, requestCataloging } from "./actions";
import { brandTotals, decimal, type Lookup, type Option, type Result } from "./model";
import { BarcodeScanner } from "./scanner";
import { ReceiptForm } from "./receipt-form";
import { ProductResearch } from "./product-research";
import type { ProductDraft } from "@/lib/inventory/product-research";

type SiteOption=Option & {headquarters_id:string};
export function Receiving({sites,locations,containers,templates,isAdmin,canCreate,initialSite}:{sites:Option[];locations:SiteOption[];containers:SiteOption[];templates:InventoryTemplateDefinition[];isAdmin:boolean;canCreate:boolean;initialSite:string}) {
  const [site,setSite]=useState(initialSite);
  const [code,setCode]=useState("");
  const [lookup,setLookup]=useState<Lookup|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [receiptKey,setReceiptKey]=useState(0);
  const [received,setReceived]=useState(false);
  const [locked,setLocked]=useState(false);
  const serial=useRef(0);
  const router=useRouter();
  useEffect(()=>{
    try {
      const saved=JSON.parse(sessionStorage.getItem("iae-receiving-code")??"null");
      if(saved && sites.some(s=>s.id===saved.site) && typeof saved.code==="string" && saved.code.length<=128){setSite(saved.site);setCode(saved.code);}
    }catch{/* Storage is optional; manual input remains available. */}
  },[sites]);
  async function search(value:string) {
    const request=++serial.current;setCode(value.trim());setBusy(true);setError("");setLookup(null);setReceived(false);
    try {sessionStorage.setItem("iae-receiving-code",JSON.stringify({site,code:value.trim()}));}catch{}
    try {
      const response=await lookupBarcode(value,site);
      if(request!==serial.current)return;
      if(response.error)setError(response.error);else {setLookup(response);setReceiptKey(k=>k+1);}
    }catch{if(request===serial.current)setError("No se pudo consultar el código. No se ha modificado el inventario.");}
    finally{if(request===serial.current)setBusy(false);}
  }
  return <div className="ec-page"><section className="ec-card">
    <div className="ec-card-header"><h1 className="ec-h1">Recepción de material</h1></div>
    <div className="ec-card-body ec-stack">
      <p className="ec-help">Lee el código del envase. No se añadirá stock hasta confirmar la recepción. Se busca en todo el catálogo de la sede.</p>
      {!lookup && <>
        <form className="ec-form-grid" onSubmit={e=>{e.preventDefault();void search(code);}}>
          <label className="ec-label">Sede<select className="ec-select" value={site} disabled={busy||!isAdmin} onChange={e=>{setSite(e.target.value);setError("");}} required>
            <option value="">Selecciona sede</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <label className="ec-label">Código de barras<input className="ec-input" value={code} onChange={e=>setCode(e.target.value)} maxLength={128} autoComplete="off" required disabled={busy}/></label>
          <button className="ec-btn ec-btn-primary" disabled={busy||!site}>{busy?"Buscando...":"Buscar código"}</button>
        </form>
        {!busy&&site&&<BarcodeScanner onRead={value=>void search(value)}/>}
      </>}
      {error&&<p role="alert" className="ec-error">{error}</p>}
      {lookup && <>
        <div className="ec-row-wrap"><strong>{sites.find(s=>s.id===site)?.name} · Código {code}</strong>
          <button className="ec-btn" type="button" disabled={locked} onClick={()=>{setLookup(null);setCode("");setReceived(false);}}>Leer otro código</button></div>
        {lookup.barcode ? <>
          <h2 className="ec-h2"><Link href={`/dashboard/inventory/${lookup.barcode.item_id}`}>{lookup.barcode.inventory_items.name}</Link></h2>
          <p>Variante: <strong>{lookup.barcode.inventory_variants.brand} {lookup.barcode.inventory_variants.model}</strong> · {lookup.barcode.units_per_pack} {lookup.barcode.inventory_items.unit||"uds."}/envase</p>
          <div className="ec-stock-grid">{brandTotals(lookup.positions).map((group,index)=><div className="ec-stock-position" key={index}><strong>{group.label}</strong><span>{decimal(group.quantity)} {lookup.barcode?.inventory_items.unit||"uds."}</span></div>)}</div>
          <details><summary>Ver existencias y ubicaciones actuales de todas las marcas</summary>
            <div className="ec-stock-grid">{lookup.positions.map(p=><div className="ec-stock-position" key={p.id}>
              <div><strong>{positionLabel(p)}</strong><p className="ec-help">{p.inventory_stock_lots.code} · {p.inventory_stock_lots.expiration_date??"Sin caducidad"}</p></div><strong>{p.quantity} {lookup.barcode?.inventory_items.unit||"uds."}</strong>
            </div>)}</div>{!lookup.positions.length&&<p>Sin existencias.</p>}
          </details>
          {isAdmin ? <ReceiptForm key={receiptKey} barcode={lookup.barcode} locations={locations.filter(l=>l.headquarters_id===site)} containers={containers.filter(c=>c.headquarters_id===site)} onLock={setLocked} onReceived={()=>{setReceived(true);router.refresh();void lookupBarcode(code,site).then(value=>{if(!value.error)setLookup(value);}).catch(()=>{});}}/>
            : <p className="ec-help">Puedes consultar el artículo. Administración registra las entradas de stock.</p>}
          {received&&<p className="ec-help">Para otra compra, pulsa «Leer otro código». No vuelvas a confirmar esta recepción.</p>}
        </> : <UnknownCode code={code} site={site} isAdmin={isAdmin} canCreate={canCreate} templates={templates} onLock={setLocked} onLinked={()=>void search(code)}/>}
      </>}
    </div>
  </section></div>;
}

function UnknownCode({code,site,isAdmin,canCreate,templates,onLinked,onLock}:{code:string;site:string;isAdmin:boolean;canCreate:boolean;templates:InventoryTemplateDefinition[];onLinked:()=>void;onLock:(locked:boolean)=>void}) {
  const [mode,setMode]=useState<"search"|"new"|"request">("search");
  const [articles,setArticles]=useState<RequestArticle[]>([]);
  const [selected,setSelected]=useState<{id:string;name:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<Result>({});
  const [more,setMore]=useState(false);
  const [creationBusy,setCreationBusy]=useState(false);
  const [productDraft,setProductDraft]=useState<ProductDraft|null>(null);
  const [draftRevision,setDraftRevision]=useState(0);
  const retry=useRef<{kind:"link"|"request";input:unknown}|null>(null);
  const router=useRouter();
  const draftKey=`iae-code-operation-${site}-${code}`;
  useEffect(()=>{
    try{
      const saved=JSON.parse(sessionStorage.getItem(draftKey)??"null");
      if(!saved||!["link","request"].includes(saved.kind)||!saved.input||saved.input.code!==code)return;
      retry.current=saved;setMode(saved.kind==="request"?"request":"search");
      if(saved.kind==="link"&&typeof saved.input.itemId==="string")setSelected({id:saved.input.itemId,name:"Artículo pendiente de asociación"});
      setResult({error:"Hay una operación sin confirmar. Reintenta los mismos datos.",retry:true});
    }catch{}
  },[draftKey,code]);
  useEffect(()=>{onLock(busy||creationBusy||!!retry.current);return()=>onLock(false);},[busy,creationBusy,result,onLock]);
  async function submit(kind:"link"|"request",input:unknown) {
    if(busy)return;setBusy(true);
    const pending=retry.current??{kind,input};let response:Result;
    try{sessionStorage.setItem(draftKey,JSON.stringify(pending));}catch{}
    try {response=await (pending.kind==="link"?linkBarcode(pending.input):requestCataloging(pending.input));}
    catch{response={error:"Respuesta no confirmada. Reintenta sin cambiar los datos.",retry:true};}
    retry.current=response.retry?pending:null;setResult(response);setBusy(false);
    if(!response.retry)try{sessionStorage.removeItem(draftKey);}catch{}
    if(response.success&&pending.kind==="link")onLinked();
  }
  return <div className="ec-stack">
    <h2 className="ec-h2">Código nuevo en esta sede</h2>
    <p className="ec-help">Un código distinto puede corresponder al mismo artículo con otra marca. Confirma medidas, compatibilidad y unidad antes de asociarlo. La búsqueda online es opcional y siempre necesita revisión.</p>
    {!selected && mode!=="new" && <ProductResearch code={code} site={site} templates={templates} canCreate={canCreate} disabled={busy||creationBusy||!!retry.current} onDraft={draft=>{setProductDraft(draft);setDraftRevision(value=>value+1);setMode("new");setResult({});}}/>}
    <div className="ec-row-wrap">
      {isAdmin&&<button className="ec-btn" type="button" disabled={busy||creationBusy||!!retry.current} onClick={()=>{setMode("search");setResult({});}}>Asociar a un artículo</button>}
      {canCreate&&<button className="ec-btn" type="button" disabled={busy||creationBusy||!!retry.current} onClick={()=>{setMode("new");setResult({});}}>Crear artículo nuevo</button>}
      <button className="ec-btn" type="button" disabled={busy||creationBusy||!!retry.current} onClick={()=>{setMode("request");setResult({});}}>Solicitar catalogación</button>
    </div>
    {mode==="search"&&isAdmin&&!selected&&<form className="ec-stack" onSubmit={async e=>{
      e.preventDefault();const q=String(new FormData(e.currentTarget).get("query")??"");setBusy(true);setArticles([]);setResult({});
      try{const r=await searchRequestArticles(q,site);setArticles(r.articles);setMore(!!r.hasMore);if(r.error)setResult({error:r.error});else if(!r.articles.length)setResult({error:"No hay coincidencias. Prueba otro nombre o crea un artículo."});}
      catch{setResult({error:"No se pudo buscar. Reintenta."});}finally{setBusy(false);}
    }}>
      <label className="ec-label">Buscar artículo por nombre<input className="ec-input" name="query" minLength={2} maxLength={100} required/></label>
      <button className="ec-btn" disabled={busy}>Buscar en el catálogo</button>
      {articles.map(item=><button className="ec-btn ec-receiving-match" type="button" key={item.id} onClick={()=>setSelected(item)}>{item.name} · {item.sku||"Sin referencia"} · Stock: {item.current_stock} {item.unit||"uds."}</button>)}
      {more&&<p className="ec-help">Hay más coincidencias. Concreta el nombre: se muestran las primeras 20 de la búsqueda, no los primeros 20 artículos del catálogo.</p>}
    </form>}
    {mode==="new"&&!selected&&<>
      {isAdmin&&<Link href="/dashboard/templates" target="_blank" className="ec-btn">Configurar fichas en otra pestaña</Link>}
      <button className="ec-btn" type="button" onClick={()=>router.refresh()}>Actualizar catálogo de fichas</button>
      <p className="ec-help">Si no hay una ficha adecuada, solicita su configuración antes de recibir el material.</p>
      <CreateInventoryItemForm key={draftRevision} initialProductDraft={productDraft??undefined} canChooseHeadquarters={false} headquarters={[]} userHeadquartersId={site} templates={templates} locations={[]} containers={[]} draftKey={`iae-new-item-${site}-${code}`} onBusy={setCreationBusy} onCreated={(id,name)=>{setSelected({id,name});setMode(isAdmin?"search":"request");}}/>
    </>}
    {selected&&isAdmin&&mode!=="request"&&<form className="ec-stack" onSubmit={e=>{
      e.preventDefault();const f=new FormData(e.currentTarget);void submit("link",{itemId:selected.id,code,brand:f.get("brand"),model:f.get("model"),units:f.get("units")});
    }}>
      <strong>Artículo: {selected.name}</strong>
      <fieldset className="ec-form-grid ec-receiving-fieldset" disabled={busy||!!retry.current}>
        <label className="ec-label">Marca<input className="ec-input" name="brand" maxLength={80} defaultValue={productDraft?.variant?.brand??""} placeholder="Marca o Sin marca" required/></label>
        <label className="ec-label">Modelo / variante (opcional)<input className="ec-input" name="model" maxLength={80} defaultValue={productDraft?.variant?.model??""}/></label>
        <label className="ec-label">Unidades del artículo por envase<input className="ec-input" name="units" inputMode="decimal" defaultValue="1" required/></label>
        <label className="ec-checkbox"><input type="checkbox" required/>He comprobado que es equivalente y utiliza la misma unidad de medida.</label>
      </fieldset>
      <button className="ec-btn ec-btn-primary" disabled={busy}>{result.retry?"Reintentar asociación":"Guardar código y variante"}</button>
      {!retry.current&&<button type="button" className="ec-btn" disabled={busy} onClick={()=>setSelected(null)}>Elegir otro artículo</button>}
    </form>}
    {(mode==="request"||(!isAdmin&&!canCreate))&&<form className="ec-stack" onSubmit={e=>{
      e.preventDefault();const f=new FormData(e.currentTarget);void submit("request",{id:newChecklistId(),site,code,description:f.get("description"),packs:f.get("packs")});
    }}>
      <fieldset className="ec-form-grid ec-receiving-fieldset" disabled={busy||!!retry.current||!!result.requestId}>
        <label className="ec-label">Material, marca y especificaciones<textarea className="ec-textarea" name="description" minLength={3} maxLength={1000} defaultValue={selected?`Artículo creado: ${selected.name} (${selected.id}). Asociar código y recibir material.`:""} required/></label>
        <label className="ec-label">Número de envases<input className="ec-input" name="packs" type="number" min="1" max="999999999" step="1" defaultValue="1" required/></label>
      </fieldset>
      <button className="ec-btn ec-btn-primary" disabled={busy||!!result.requestId}>{result.retry?"Reintentar solicitud":"Enviar a logística sin registrar stock"}</button>
    </form>}
    {result.error&&<p role="alert" className="ec-error">{result.error}</p>}
    {result.success&&<p role="status" className="ec-success">{result.success}</p>}
    {result.requestId&&<Link href={`/dashboard/requests/${result.requestId}`} className="ec-btn">Ver solicitud</Link>}
  </div>;
}
