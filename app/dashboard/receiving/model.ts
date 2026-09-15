import { z } from "zod";
import type { StockPosition } from "../inventory/stock-model";

export const barcodeSchema = z.string().trim().regex(/^[!-~]{1,128}$/, "Introduce un código de hasta 128 caracteres, sin espacios.");
const quantity = z.string().trim().transform(v => v.replace(",", ".")).pipe(z.string().regex(/^\d{1,11}(\.\d{1,3})?$/)).refine(v => /[1-9]/.test(v), "La cantidad debe ser positiva.");
export const receiptSchema = z.object({
  id: z.string().uuid(), barcodeId: z.string().uuid(), packs: z.string().regex(/^[1-9]\d{0,10}$/),
  lotCode: z.string().trim().max(80), notes: z.string().trim().min(3).max(1000),
  expiration: z.string().refine(v => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith("0000") && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v)),
  allocations: z.array(z.object({
    quantity, location_id: z.string().uuid().nullable(), container_id: z.string().uuid().nullable()
  }).refine(v => !(v.location_id && v.container_id), "Elige caja o ubicación, no ambas.")).min(1).max(100)
});
export const linkSchema = z.object({ itemId: z.string().uuid(), code: barcodeSchema, brand: z.string().trim().min(1).max(80), model: z.string().trim().max(80), units: quantity.refine(v => Number(v)<=999999) });
export type Barcode = {
  expiryRequired?: boolean;
  id: string; code: string; item_id: string; units_per_pack: number;
  inventory_variants: { brand: string; model: string };
  inventory_items: { id: string; name: string; unit: string | null; current_stock: number; template_id?: string | null };
};
export type Lookup = { barcode: Barcode | null; positions: StockPosition[]; error?: string };
export type ReceiptInput = z.input<typeof receiptSchema>;
export type Result = { error?: string; success?: string; retry?: boolean; requestId?: string };
export type Option = { id: string; name: string };

// Integer thousandths avoid floating-point discrepancies in the confirmation summary.
export function milli(value: string): bigint {
  if (!/^\d{1,11}([.,]\d{1,3})?$/.test(value)) return 0n;
  const [whole, fraction=""] = value.replace(",", ".").split(".");
  return BigInt(whole)*1000n+BigInt(fraction.padEnd(3,"0"));
}
export function decimal(value: bigint) { return `${value/1000n}.${String(value%1000n).padStart(3,"0")}`; }
export function brandTotals(positions: StockPosition[]) {
  const groups=new Map<string,{label:string;quantity:bigint}>();
  for(const position of positions) {
    const variant=position.inventory_stock_lots.inventory_variants;
    const key=JSON.stringify(variant?[variant.brand,variant.model]:null);
    const group=groups.get(key)??{label:variant?`${variant.brand}${variant.model?` / ${variant.model}`:""}`:"Marca no registrada",quantity:0n};
    group.quantity+=milli(String(position.quantity));groups.set(key,group);
  }
  return [...groups.values()];
}
export function receivingError(error: {code?: string; message?: string}): Result {
  if (["42P01","42703","PGRST202","PGRST200","PGRST204","PGRST205"].includes(error.code ?? "")) return { error: "Falta activar la recepción: ejecuta supabase/upgrade-barcode-receiving.sql en Supabase." };
  if (error.code === "P0001") return { error: error.message ?? "Revisa los datos." };
  if (error.code === "23505") return { error: "El código o lote ya existe. Vuelve a consultarlo." };
  if (error.code?.startsWith("22") || error.code?.startsWith("23")) return { error: "Datos incompatibles con el artículo. Revisa cantidad, serie y destinos." };
  return { error: "No se pudo confirmar la respuesta. Reintenta sin cambiar los datos.", retry: true };
}
