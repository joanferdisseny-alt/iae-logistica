import Link from "next/link";
import { QrModal } from "../qr-modal";
import { currentInventoryStatus, inventoryToday } from "@/lib/inventory/expiry-status";
import { sortedSizeVariants, type SizeProduct } from "@/lib/inventory/size-catalog";

export function SizeSummary({ product, selectedId }: { product: SizeProduct; selectedId: string }) {
  const today = inventoryToday();
  return <section className="ec-card">
    <div className="ec-card-header ec-row-wrap">
      <div className="ec-col"><span className="ec-help">Ficha de la prenda</span><h1 className="ec-h1">{product.name}</h1></div>
      <div className="ec-actions">
        <span className="ec-badge ec-badge-neutral">{product.current_stock} {product.unit ?? "uds."} en total</span>
        <QrModal label="QR de prenda" path={`/dashboard/inventory/${product.id}`} title={product.name} />
        <Link className="ec-btn" href="/dashboard/inventory">Volver</Link>
      </div>
    </div>
    <div className="ec-card-body ec-stack">
      <p className="ec-help">{product.size_count} tallas en una sola ficha. Selecciona una talla para consultar sus ubicaciones, registrar movimientos o ver su historial. Cero significa sin existencias; las tallas que no existen no se muestran.</p>
      <div className="ec-table-wrap"><table className="ec-table">
        <caption className="ec-help">Existencias disponibles por talla</caption>
        <thead><tr><th scope="col">Talla</th><th scope="col">Unidades</th><th scope="col">Alerta</th><th scope="col">Detalle</th></tr></thead>
        <tbody>{sortedSizeVariants(product.variants).map(variant => {
          const status = currentInventoryStatus({ ...variant, current_stock: variant.quantity }, today);
          return <tr key={variant.id}>
            <th scope="row">{variant.size}</th><td>{variant.quantity}</td>
            <td>{Number(variant.quantity) === 0 ? "Sin existencias" : ({ ok: "Correcto", low: "Stock bajo", expired: "Caducado", maintenance: "Mantenimiento" } as Record<string, string>)[status] ?? status}</td>
            <td><Link className="ec-btn" href={`/dashboard/inventory/${variant.id}#talla`} aria-current={variant.id === selectedId ? "true" : undefined} aria-label={`Ver existencias de talla ${variant.size}`}>
              {variant.id === selectedId ? "Seleccionada" : "Ver talla"}
            </Link></td>
          </tr>;
        })}</tbody>
      </table></div>
    </div>
  </section>;
}
