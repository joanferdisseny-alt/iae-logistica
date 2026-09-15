"use client";

import { useEffect, useRef, useState } from "react";
import { receiveBarcode } from "./actions";
import { decimal, milli, receiptSchema, type Barcode, type Option, type ReceiptInput, type Result } from "./model";
import { newChecklistId } from "../checklists/id";

export function ReceiptForm({barcode,locations,containers,onReceived,onLock}:{barcode:Barcode;locations:Option[];containers:Option[];onReceived:()=>void;onLock:(locked:boolean)=>void}) {
  const [packs,setPacks]=useState("1");
  const [rows,setRows]=useState([{key:0,destination:"",quantity:String(barcode.units_per_pack)}]);
  const [result,setResult]=useState<Result>({});
  const [pending,setPending]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [preview,setPreview]=useState<ReceiptInput|null>(null);
  const uncertain=useRef<ReceiptInput|null>(null);
  const nextKey=useRef(1);
  const storageKey=`iae-receipt-${barcode.id}`;
  useEffect(()=>{
    try {
      const stored=JSON.parse(sessionStorage.getItem(storageKey)??"null");
      const parsed=receiptSchema.safeParse(stored);
      if(!parsed.success||parsed.data.barcodeId!==barcode.id)return;
      const input=parsed.data;
      uncertain.current=input;setPreview(input);setPacks(input.packs);
      setRows(input.allocations.map((row,key)=>({key,destination:row.location_id?`l:${row.location_id}`:row.container_id?`c:${row.container_id}`:"",quantity:row.quantity})));
      nextKey.current=input.allocations.length;
      setResult({error:"Hay una recepción sin respuesta confirmada. Reintenta la misma operación; no se duplicará el stock.",retry:true});
    }catch{/* Recovery is best-effort when browser storage is unavailable. */}
  },[barcode.id,storageKey]);
  useEffect(()=>{onLock(pending||!!preview||!!uncertain.current);return()=>onLock(false);},[pending,preview,onLock]);
  const total=/^[1-9]\d{0,10}$/.test(packs)?BigInt(packs)*milli(String(barcode.units_per_pack)):0n;
  const assigned=rows.reduce((sum,row)=>sum+milli(row.quantity),0n);
  async function save(input:ReceiptInput) {
    if(pending || confirmed) return;
    setPending(true);
    try{sessionStorage.setItem(storageKey,JSON.stringify(input));}catch{}
    let response:Result;
    try {response=await receiveBarcode(input);} catch {response={error:"Respuesta no confirmada. Reintenta con los mismos datos.",retry:true};}
    uncertain.current=response.retry?input:null;
    if(!response.retry)try{sessionStorage.removeItem(storageKey);}catch{}
    setResult(response);setPending(false);
    if(response.success){setConfirmed(true);setPreview(null);onReceived();}
    else if(!response.retry) setPreview(null);
  }
  return <form className="ec-stack" onSubmit={event=>{
    event.preventDefault();if(pending||confirmed)return;
    if(uncertain.current){void save(uncertain.current);return;}
    const form=new FormData(event.currentTarget);
    if(total<=0n||assigned!==total||rows.some(r=>milli(r.quantity)<=0n)){setResult({error:"Reparte exactamente todas las unidades recibidas."});return;}
    setResult({});setPreview({id:newChecklistId(),barcodeId:barcode.id,packs,lotCode:String(form.get("lotCode")??""),expiration:String(form.get("expiration")??""),notes:String(form.get("notes")??""),
      allocations:rows.map(row=>({quantity:row.quantity,location_id:row.destination.startsWith("l:")?row.destination.slice(2):null,container_id:row.destination.startsWith("c:")?row.destination.slice(2):null}))});
  }}>
    <h3 className="ec-h3">Registrar entrada</h3>
    <fieldset className="ec-stack ec-receiving-fieldset" disabled={pending||confirmed||!!preview||!!uncertain.current}>
      <div className="ec-form-grid">
        <label className="ec-label">Envases recibidos<input className="ec-input" type="number" min="1" step="1" max="99999999999" value={packs} onChange={e=>setPacks(e.target.value)} required/></label>
        <label className="ec-label">Lote del fabricante (opcional)<input className="ec-input" name="lotCode" maxLength={80}/></label>
        <label className="ec-label">Caducidad del lote {barcode.expiryRequired?"(obligatoria)":"(si corresponde)"}<input className="ec-input" type="date" name="expiration" required={barcode.expiryRequired}/></label>
        <label className="ec-label">Motivo / referencia<input className="ec-input" name="notes" defaultValue="Compra de material" minLength={3} maxLength={1000} required/></label>
      </div>
      <p className="ec-help">{barcode.units_per_pack} {barcode.inventory_items.unit||"uds."} por envase. Reparte unidades, no envases. Un lote diferente requiere otra recepción.</p>
      {rows.map(row=><div className="ec-receiving-allocation" key={row.key}>
        <label className="ec-label">Destino<select className="ec-select" value={row.destination} onChange={e=>setRows(rows.map(r=>r.key===row.key?{...r,destination:e.target.value}:r))}>
          <option value="">Sin ubicación asignada</option>
          <optgroup label="Ubicaciones">{locations.map(l=><option key={l.id} value={`l:${l.id}`}>{l.name}</option>)}</optgroup>
          <optgroup label="Cajas">{containers.map(c=><option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>
        </select></label>
        <label className="ec-label">Unidades<input className="ec-input" inputMode="decimal" value={row.quantity} onChange={e=>setRows(rows.map(r=>r.key===row.key?{...r,quantity:e.target.value}:r))} required pattern="[0-9]+([.,][0-9]{1,3})?"/></label>
        <button className="ec-btn" type="button" disabled={rows.length===1} aria-label={`Quitar destino ${rows.indexOf(row)+1}`} onClick={()=>setRows(rows.filter(r=>r.key!==row.key))}>Quitar</button>
      </div>)}
      <button className="ec-btn" type="button" disabled={rows.length>=100} onClick={()=>setRows([...rows,{key:nextKey.current++,destination:"",quantity:""}])}>Añadir destino</button>
    </fieldset>
    <p aria-live="polite"><strong>Total recibido: {decimal(total)} · Repartido: {decimal(assigned)}</strong></p>
    {preview && !confirmed && <div className="ec-stock-position ec-stack">
      <strong>Confirmar entrada de {decimal(total)} {barcode.inventory_items.unit||"uds."} de {barcode.inventory_items.name}</strong>
      <p>{barcode.inventory_variants.brand} {barcode.inventory_variants.model} · {rows.length} destino(s). Se sumará al stock actual.</p>
      <p className="ec-help">Lote: {preview.lotCode||"Sin referencia del fabricante"} · Caducidad: {preview.expiration||"Sin fecha"} · Motivo: {preview.notes}</p>
      <div className="ec-row-wrap">
        <button type="button" className="ec-btn ec-btn-primary" disabled={pending} onClick={()=>void save(uncertain.current??preview)}>{pending?"Registrando...":uncertain.current?"Reintentar misma recepción":"Confirmar recepción"}</button>
        {!uncertain.current && <button type="button" className="ec-btn" disabled={pending} onClick={()=>setPreview(null)}>Revisar reparto</button>}
      </div>
    </div>}
    {result.error && <p className="ec-error" role="alert">{result.error}</p>}
    {result.success && <p className="ec-success" role="status">{result.success}</p>}
    {!preview&&!confirmed && <button className="ec-btn ec-btn-primary" disabled={pending} type="submit">Revisar entrada</button>}
  </form>;
}
