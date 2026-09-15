import { z } from "zod";

const optionalId = z.union([z.string().uuid(), z.literal("")]).transform(value => value || null);
export const stockSchema = z.object({
  requestId: z.string().uuid(), itemId: z.string().uuid(),
  operation: z.enum(["in", "out", "transfer", "adjustment", "new_lot", "edit_lot"]),
  sourceId: optionalId, lotId: optionalId,
  expectedQuantity: z.string().regex(/^(\d{1,11}(\.\d{1,3})?)?$/).default(""),
  destination: z.enum(["none", "location", "container"]), locationId: optionalId, containerId: optionalId,
  quantity: z.string().trim().transform(value => value.replace(",", "."))
    .pipe(z.string().regex(/^\d{1,11}(\.\d{1,3})?$/)),
  notes: z.string().trim().min(3).max(2000), lotCode: z.string().trim().max(120),
  expirationDate: z.string().refine(value => value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000") &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value))
}).superRefine((v, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: "custom", message });
  if (["out","transfer","adjustment"].includes(v.operation) && !v.sourceId) bad("Selecciona la existencia de origen.");
  if (["in","edit_lot"].includes(v.operation) && !v.lotId) bad("Selecciona el lote.");
  if (["new_lot","edit_lot"].includes(v.operation) && !v.lotCode) bad("Indica el código del lote.");
  if (["in","out","transfer"].includes(v.operation) && !/[1-9]/.test(v.quantity)) bad("La cantidad debe ser mayor que cero.");
  if (["in","transfer","new_lot"].includes(v.operation) &&
    ((v.destination === "location" && !v.locationId) || (v.destination === "container" && !v.containerId))) bad("Selecciona el destino.");
});
export type StockLot = { id: string; code: string; expiration_date: string | null; inventory_variants?: { brand: string; model: string } | null };
export type StockPosition = {
  notes?: string;
  id: string; lot_id: string; quantity: number;
  location_id: string | null; container_id: string | null;
  inventory_stock_lots: StockLot;
  locations: { name: string } | null;
  inventory_containers: { name: string; locations: { name: string } | null } | null;
};
export type StockOption = { id: string; name: string };
export function positionLabel(position: StockPosition) {
  const box = position.inventory_containers;
  return box ? `Caja: ${box.name}${box.locations ? ` · ${box.locations.name}` : ""}` : position.locations?.name ?? "Sin ubicación asignada";
}
