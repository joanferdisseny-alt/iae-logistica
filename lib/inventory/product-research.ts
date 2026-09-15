import { z } from "zod";
import type { InventoryTemplateDefinition, InventoryTemplateField } from "./templates";

export type ProductProvider = "upcitemdb" | "openfoodfacts";
export const productProviders: Record<ProductProvider, string> = {
  upcitemdb: "UPCitemdb", openfoodfacts: "Open Food Facts"
};
export const factLabels = {
  name: "Nombre", brand: "Marca", model: "Modelo", description: "Descripción",
  color: "Color", size: "Talla / tamaño", dimensions: "Dimensiones", weight: "Peso",
  ingredients: "Ingredientes", packaging: "Presentación del envase"
};
export type ProductFact = { key: keyof typeof factLabels; value: string };
export type ProductCandidate = {
  provider: ProductProvider; code: string; url: string; fetchedAt: string; facts: ProductFact[];
};
export type ProductResearchResult = { candidate?: ProductCandidate; error?: string; notFound?: boolean };
export type ProductDraft = { templateCode: string; values: Record<string, string>; source: ProductSource; variant?: { brand: string; model: string } };

// Only genuine GTINs go to third parties. Internal codes and QR URLs stay local.
export function validProductCode(code: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code) || /^0+$/.test(code)) return false;
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(code[i]) * weight;
  return (10 - sum % 10) % 10 === Number(code.at(-1));
}

export function productSourceUrl(provider: ProductProvider, code: string): string {
  return provider === "upcitemdb" ? `https://www.upcitemdb.com/upc/${code}` : `https://world.openfoodfacts.org/product/${code}`;
}

export const productSourceSchema = z.object({
  provider: z.enum(["upcitemdb", "openfoodfacts"]),
  code: z.string().refine(validProductCode),
  fetchedAt: z.string().datetime(),
  reviewed: z.literal(true)
}).strict();
export type ProductSource = z.infer<typeof productSourceSchema>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 2000) : "";
}
function sameCode(value: unknown, requested: string): boolean {
  return typeof value === "string" && validProductCode(value) && value.padStart(14, "0") === requested.padStart(14, "0");
}

export function parseProductResponse(provider: ProductProvider, code: string, data: unknown, now = new Date()): ProductCandidate | null {
  if (!validProductCode(code)) return null;
  const root = object(data);
  let values: Partial<Record<ProductFact["key"], unknown>>;
  if (provider === "upcitemdb") {
    if (root.code !== "OK" || !Array.isArray(root.items)) return null;
    const matches = root.items.map(object).filter(item => [item.ean, item.upc, item.gtin].some(value => sameCode(value, code)));
    // Conflicting candidates must never silently select a product.
    if (matches.length !== 1) return null;
    const item = matches[0];
    values = { name: item.title, brand: item.brand, model: item.model, description: item.description,
      color: item.color, size: item.size, dimensions: item.dimension, weight: item.weight };
  } else {
    const item = object(root.product);
    if (root.status !== "success" || object(root.result).id !== "product_found" || !sameCode(item.code, code)) return null;
    values = { name: clean(item.product_name_es) || item.product_name, brand: item.brands,
      description: clean(item.generic_name_es) || item.generic_name,
      ingredients: clean(item.ingredients_text_es) || item.ingredients_text, packaging: item.quantity };
  }
  const facts = Object.entries(values).flatMap(([key, value]) => {
    const text = clean(value);
    return text ? [{ key: key as ProductFact["key"], value: text }] : [];
  });
  if (!facts.some(fact => fact.key === "name")) return null;
  return { provider, code, url: productSourceUrl(provider, code), fetchedAt: now.toISOString(), facts };
}

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Record<ProductFact["key"], string[]> = {
  name: ["name", "item_name", "nombre", "nombre del articulo", "nombre del producto"],
  brand: ["brand", "marca"], model: ["model", "modelo"], description: ["description", "descripcion"],
  color: ["color"], size: ["size", "talla", "tamano"], dimensions: ["dimensions", "dimensiones"],
  weight: ["weight", "peso"], ingredients: ["ingredients", "ingredientes"], packaging: ["packaging", "presentacion"]
};

export function canPrefillField(field: InventoryTemplateField): boolean {
  if (!["text", "textarea", "select", "number"].includes(field.type)) return false;
  // Operational values cannot be learned from a product catalogue, even if configured as text.
  return !/stock|cantidad|quantity|caduc|expir|fecha|date|lote|lotcode|batch|serial|serie|ubic|location|container|caja|sede|headquarter|maintenance|mantenim|estado|status|alert|aviso|unidad|unit|sku/.test(normalize(field.key) + normalize(field.label));
}

export function compatibleFactValue(field: InventoryTemplateField, fact?: ProductFact): string {
  if (!fact || !canPrefillField(field)) return "";
  const choice = (value: string) => value.trim().normalize("NFC").toLocaleLowerCase("es").replace(/\s+/g, " ");
  if (field.type === "select") return field.options?.find(option => choice(option) === choice(fact.value)) ?? "";
  if (field.type === "number") return /^-?\d+(?:\.\d{1,3})?$/.test(fact.value) && Number.isFinite(Number(fact.value)) ? fact.value : "";
  return fact.value;
}

export function suggestedProductValues(template: InventoryTemplateDefinition, candidate: ProductCandidate): Record<string, string> {
  return Object.fromEntries(template.fields.flatMap(field => {
    const fact = candidate.facts.find(f => aliases[f.key].some(alias => [normalize(field.key), normalize(field.label)].includes(normalize(alias))));
    const value = compatibleFactValue(field, fact);
    return value ? [[field.key, value]] : [];
  }));
}
