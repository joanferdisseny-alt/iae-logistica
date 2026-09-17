import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/context";
import { QrModal } from "@/app/dashboard/qr-modal";
import { stockQrPath } from "@/app/dashboard/checklists/scan-model";

export const dynamic = "force-dynamic";

type Position = {
  id: string; item_id: string; container_id: string | null; quantity: number;
  inventory_items: { name: string; unit: string | null } | null;
  inventory_stock_lots: { code: string; expiration_date: string | null; inventory_variants: { brand: string; model: string } | null } | null;
  inventory_containers: { name: string; locations: { name: string } | null } | null;
  locations: { name: string } | null;
};

export default async function StockQrPage({ params }: { params: Promise<{ positionId: string }> }) {
  const { positionId } = await params;
  if (!z.string().uuid().safeParse(positionId).success) notFound();
  const { supabase } = await requireAccess();
  const { data: position, error } = await supabase.from("inventory_stock_positions")
    .select("id, item_id, container_id, quantity, inventory_items(name, unit), inventory_stock_lots(code, expiration_date, inventory_variants(brand, model)), inventory_containers(name, locations(name)), locations(name)")
    .eq("id", positionId).maybeSingle<Position>();
  if (error) throw new Error("No se han podido consultar las existencias. Vuelve a intentarlo.");
  if (!position) notFound();
  const name = position.inventory_items?.name ?? "Artículo no disponible";
  const lot = position.inventory_stock_lots;
  const box = position.inventory_containers;
  const variant = lot?.inventory_variants;
  return <div className="ec-page"><section className="ec-card">
    <div className="ec-card-header"><h1 className="ec-h2">{name}</h1></div>
    <div className="ec-card-body ec-stack">
      <p><strong>Destino:</strong> {box ? `Caja: ${box.name}` : position.locations?.name ?? "Sin ubicación asignada"}</p>
      {box?.locations && <p className="ec-help">Ubicación de la caja: {box.locations.name}</p>}
      <p><strong>Existencias actuales:</strong> {position.quantity} {position.inventory_items?.unit ?? "uds."}</p>
      <p className="ec-help">Lote: {lot?.code ?? "No disponible"} · Caducidad: {lot?.expiration_date ?? "Sin fecha"}</p>
      {variant && <p className="ec-help">Marca / modelo: {[variant.brand, variant.model].filter(Boolean).join(" · ")}</p>}
      {Number(position.quantity) === 0 && <p className="ec-help">No quedan existencias en este destino. La etiqueta se conserva para consultar su referencia; no acredita una devolución.</p>}
      <p className="ec-help">Para comprobar devoluciones, abre el checklist de la caja y utiliza «Escanear devoluciones». Abrir este enlace no registra ninguna comprobación.</p>
      <div className="ec-actions">
        <Link className="ec-btn" href={`/dashboard/inventory/${position.item_id}`}>Ver artículo</Link>
        {position.container_id && <>
          <Link className="ec-btn" href={`/dashboard/locations/containers/${position.container_id}`}>Ver caja</Link>
          <Link className="ec-btn ec-btn-primary" href={`/dashboard/checklists?container=${position.container_id}`}>Checklists de esta caja</Link>
        </>}
        <QrModal label="QR de existencias" path={stockQrPath(position.id)} title={`${name} · ${box?.name ?? position.locations?.name ?? "Sin ubicación"} · Lote ${lot?.code ?? ""}`} />
      </div>
    </div>
  </section></div>;
}
