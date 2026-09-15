"use server";

import { z } from "zod";
import { requireAccess } from "@/lib/auth/context";
import { allowProductResearch, fetchProductResearch } from "@/lib/inventory/product-research-server";
import { validProductCode, type ProductResearchResult } from "@/lib/inventory/product-research";

export async function researchProduct(input: unknown): Promise<ProductResearchResult> {
  const { supabase, user, isAdmin, profile } = await requireAccess();
  const parsed = z.object({ provider: z.enum(["upcitemdb", "openfoodfacts"]), code: z.string().refine(validProductCode), site: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Introduce un EAN/UPC/GTIN válido y selecciona una sede. Los códigos internos no se envían a internet." };
  const { code, provider, site } = parsed.data;
  if (!isAdmin && site !== profile.headquarters_id) return { error: "No puedes consultar otra sede." };
  if (!allowProductResearch(user.id)) return { error: "Demasiadas consultas seguidas. Espera un minuto antes de volver a buscar." };
  const { data, error } = await supabase.from("inventory_barcodes").select("id").eq("headquarters_id", site).eq("code", code).maybeSingle();
  if (error) return { error: "No se pudo comprobar el catálogo local. Reintenta antes de buscar fuera." };
  if (data) return { error: "El código ya está registrado. Vuelve a buscarlo en Recepción para consultar sus existencias." };
  return fetchProductResearch(provider, code);
}
