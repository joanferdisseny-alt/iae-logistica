"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/context";
import { barcodeSchema, linkSchema, receiptSchema, receivingError, type Barcode, type Lookup, type Result } from "./model";
import type { StockPosition } from "../inventory/stock-model";

export async function lookupBarcode(code: string, siteId: string): Promise<Lookup> {
  const { supabase, profile, isAdmin } = await requireAccess();
  const site = isAdmin ? siteId : profile.headquarters_id;
  const parsed = barcodeSchema.safeParse(code);
  if (!parsed.success || !z.string().uuid().safeParse(site).success) return { barcode: null, positions: [], error: "Selecciona una sede e introduce un código válido." };
  const { data: barcode, error } = await supabase.from("inventory_barcodes")
    .select("id, code, item_id, units_per_pack, inventory_variants(brand, model), inventory_items(id, name, unit, current_stock, template_id)")
    .eq("headquarters_id",site).eq("code",parsed.data).maybeSingle<Barcode>();
  if (error) return { barcode:null, positions:[], ...receivingError(error) };
  if (!barcode) return { barcode:null, positions:[] };
  if(barcode.inventory_items.template_id) {
    const {data,error}=await supabase.from("inventory_template_fields").select("is_required, inventory_fields!inner(field_key)")
      .eq("template_id",barcode.inventory_items.template_id).eq("inventory_fields.field_key","expiration_date");
    if(error||!data)return {barcode:null,positions:[],error:"No se pudo comprobar la configuración de caducidad. Vuelve a consultar."};
    barcode.expiryRequired=data.some(field=>field.is_required);
  }
  const positions: StockPosition[]=[];
  for (let from=0; ; from+=500) {
    const { data, error } = await supabase.from("inventory_stock_positions")
      .select("id, lot_id, quantity, location_id, container_id, inventory_stock_lots(id, code, expiration_date, inventory_variants(brand, model)), locations(name), inventory_containers(name, locations(name))")
      .eq("item_id",barcode.item_id).gt("quantity",0).order("id").range(from,from+499).returns<StockPosition[]>();
    if (error || !data) return { barcode:null, positions:[], error:"No se pudieron cargar todas las existencias. Vuelve a consultar." };
    positions.push(...data); if (data.length<500) break;
  }
  return { barcode, positions };
}

export async function linkBarcode(input: unknown): Promise<Result> {
  const { isAdmin, supabase } = await requireAccess();
  if (!isAdmin) return { error:"Solo administración puede asociar códigos." };
  const parsed=linkSchema.safeParse(input);
  if (!parsed.success) return {error:"Revisa marca, código y unidades por envase."};
  const v=parsed.data;
  try {
    const { error }=await supabase.rpc("link_inventory_barcode",{p_item_id:v.itemId,p_code:v.code,p_brand:v.brand,p_model:v.model,p_units:v.units});
    if (error) return receivingError(error);
  } catch { return receivingError({}); }
  revalidatePath("/dashboard", "layout");
  return {success:"Código asociado. Revisa el reparto antes de registrar la entrada."};
}

export async function receiveBarcode(input: unknown): Promise<Result> {
  const {isAdmin,supabase}=await requireAccess();
  if (!isAdmin) return {error:"Solo administración puede registrar entradas."};
  const parsed=receiptSchema.safeParse(input);
  if (!parsed.success) return {error:"Revisa cantidades, fecha, motivo y destinos."};
  const v=parsed.data;
  try {
    const {error}=await supabase.rpc("receive_inventory_barcode",{p_id:v.id,p_barcode_id:v.barcodeId,p_packs:v.packs,
      p_lot_code:v.lotCode,p_expiration:v.expiration||null,p_allocations:v.allocations,p_notes:v.notes});
    if (error) return receivingError(error);
  } catch {return receivingError({});}
  revalidatePath("/dashboard","layout");
  return {success:"Recepción registrada. Todas las cantidades se han añadido a sus destinos."};
}

export async function requestCataloging(input: unknown): Promise<Result> {
  const {supabase,isAdmin,profile}=await requireAccess();
  const parsed=z.object({id:z.string().uuid(),site:z.string().uuid(),code:barcodeSchema,description:z.string().trim().min(3).max(1000),packs:z.string().regex(/^[1-9]\d{0,8}$/)}).safeParse(input);
  if (!parsed.success) return {error:"Indica descripción y número entero de envases."};
  const v=parsed.data;
  try {
    const {data,error}=await supabase.rpc("request_barcode_cataloging",{p_id:v.id,p_site:isAdmin?v.site:profile.headquarters_id,p_code:v.code,p_description:v.description,p_packs:v.packs});
    if(error) return receivingError(error);
    revalidatePath("/dashboard/requests");
    return {success:"Solicitud de catalogación enviada a logística. No se ha sumado stock.",requestId:data};
  } catch {return receivingError({});}
}
