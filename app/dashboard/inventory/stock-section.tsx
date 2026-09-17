import Link from "next/link";
import { requireAccess } from "@/lib/auth/context";
import { StockForm } from "./stock-form";
import { QrModal } from "../qr-modal";
import { stockQrPath } from "../checklists/scan-model";
import { brandTotals, decimal } from "../receiving/model";
import { positionLabel, type StockPosition, type StockLot, type StockOption } from "./stock-model";

export async function StockSection({ itemId, itemName, headquartersId, unit }: { itemId: string; itemName: string; headquartersId: string | null; unit: string | null }) {
  const { supabase, isAdmin } = await requireAccess();
  const positions: StockPosition[] = [];
  const lots: StockLot[] = [];
  const locations: StockOption[] = [], containers: StockOption[] = [];
  for (let from=0; ; from+=500) {
    const { data, error } = await supabase.from("inventory_stock_positions")
      .select("id, lot_id, quantity, location_id, container_id, notes, inventory_stock_lots(id, code, expiration_date, inventory_variants(brand, model)), locations(name), inventory_containers(name, locations(name))")
      .eq("item_id",itemId).order("id").range(from,from+499).returns<StockPosition[]>();
    if (error || !data) return <section className="ec-card"><div className="ec-card-body ec-error" role="alert">No se pudieron cargar las existencias. Comprueba que se ha ejecutado supabase/upgrade-barcode-receiving.sql.</div></section>;
    positions.push(...data); if (data.length<500) break;
  }
  let optionsError = false;
  if (isAdmin) {
    for (let from=0; ; from+=500) {
      const { data,error } = await supabase.from("inventory_stock_lots").select("id, code, expiration_date").eq("item_id",itemId).order("code").order("id").range(from,from+499).returns<StockLot[]>();
      if (error || !data) { optionsError=true; break; } lots.push(...data); if (data.length<500) break;
    }
    for (const [table, target] of [["locations", locations],["inventory_containers",containers]] as const) {
      for (let from=0; ; from+=500) {
        const { data,error } = await supabase.from(table).select("id, name").eq("headquarters_id",headquartersId).eq("is_active",true).order("name").order("id").range(from,from+499).returns<StockOption[]>();
        if (error || !data) { optionsError=true; break; } target.push(...data); if (data.length<500) break;
      }
    }
  }
  const positive = positions.filter(p => p.quantity>0);
  return <section className="ec-card" id="existencias">
    <div className="ec-card-header ec-row-wrap"><h2 className="ec-h2">Existencias y ubicaciones</h2>
      {isAdmin && !optionsError && <StockForm itemId={itemId} positions={positions} lots={lots} locations={locations} containers={containers} />}</div>
    <div className="ec-card-body ec-stack">
      <p className="ec-help">Una ficha, varias cantidades. Cada caja hereda su ubicación física. Los lotes conservan su propia caducidad.</p>
      <div className="ec-stock-grid">{brandTotals(positive).map((group,index)=><div className="ec-stock-position" key={index}><span>{group.label}</span><strong>{decimal(group.quantity)} {unit??"uds."}</strong></div>)}</div>
      {isAdmin && <p className="ec-help">Para entradas identificadas por marca, utiliza <Link href="/dashboard/receiving">Recepción</Link>. Los lotes manuales o antiguos sin variante se muestran como marca no registrada.</p>}
      {optionsError && <p className="ec-error">No se pudieron cargar los destinos. La gestión no está disponible.</p>}
      <div className="ec-stock-grid">{positive.map(p => <div className="ec-stock-position" key={p.id}>
        <div><strong>{p.container_id ? <Link href={`/dashboard/locations/containers/${p.container_id}`}>{positionLabel(p)}</Link> : positionLabel(p)}</strong>
          <p className="ec-help">Lote: {p.inventory_stock_lots.code} · Caducidad: {p.inventory_stock_lots.expiration_date ?? "Sin fecha"}</p>
          {p.notes && <p className="ec-help">{p.notes}</p>}</div>
        <strong>{p.quantity} {unit ?? "uds."}</strong>
        <QrModal label="QR de existencias" path={stockQrPath(p.id)} title={`${itemName} · ${positionLabel(p)} · Lote ${p.inventory_stock_lots.code}`} />
      </div>)}</div>
      {!positive.length && <p className="ec-muted">Sin existencias. Registra una entrada o recibe un nuevo lote.</p>}
    </div>
  </section>;
}
