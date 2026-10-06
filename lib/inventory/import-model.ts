export type ImportFieldType = "text" | "textarea" | "number" | "date" | "boolean" | "select";
export type ImportField = { key: string; label: string; type: ImportFieldType };
export type ImportColumn = { target: string; key: string; type: ImportFieldType };
export type ImportTable = { headers: string[]; rows: string[][] };
export type ImportPlan = {
  lines: { row: number; name: string; sku: string | null; item_id: string | null; action: "create" | "add"; category: string; template: string; before: number; quantity: number; after: number; lot: string; expiration: string | null; specs: Record<string, string>; details: Record<string, string | number | boolean | null> }[];
  categories: string[]; templates: string[]; fields: string[]; assignments: string[];
};
export const importTargets = [
  ["ignore", "No importar"], ["name", "Nombre del artículo"], ["sku", "Referencia / SKU"],
  ["id", "ID del artículo (UUID)"], ["quantity", "Cantidad que entra"], ["category", "Categoría"],
  ["subcategory", "Subcategoría (niveles separados por >)"], ["template", "Tipo de artículo / ficha"],
  ["unit", "Unidad"], ["lot_code", "Lote"], ["expiration_date", "Caducidad"],
  ["serial_number", "Número de serie"], ["minimum_stock", "Stock mínimo"],
  ["is_consumable", "Fungible (sí / no)"], ["description", "Descripción"], ["custom", "Campo de la ficha"]
] as const;
export const coreImportFields: Record<string, ImportField> = {
  name: { key: "name", label: "Nombre", type: "text" }, quantity: { key: "current_stock", label: "Existencias", type: "number" },
  sku: { key: "sku", label: "Referencia / SKU", type: "text" }, unit: { key: "unit", label: "Unidad", type: "text" },
  lot_code: { key: "lot_code", label: "Lote", type: "text" }, expiration_date: { key: "expiration_date", label: "Caducidad", type: "date" },
  serial_number: { key: "serial_number", label: "Número de serie", type: "text" }, minimum_stock: { key: "minimum_stock", label: "Stock mínimo", type: "number" },
  is_consumable: { key: "is_consumable", label: "Fungible", type: "boolean" }, description: { key: "description", label: "Descripción", type: "textarea" }
};
export const importFieldKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
export function suggestImportColumns(headers: string[], fields: ImportField[]): ImportColumn[] {
  const aliases: Record<string, string> = { nombre: "name", articulo: "name", producto: "name", item_name: "name", referencia: "sku", codigo: "sku", cantidad: "quantity", stock: "quantity", current_stock: "quantity", categoria: "category", category_code: "category", subcategoria: "subcategory", ficha: "template", tipo: "template", template_code: "template", unidad: "unit", lote: "lot_code", caducidad: "expiration_date", fecha_caducidad: "expiration_date", numero_de_serie: "serial_number", descripcion: "description", fungible: "is_consumable", stock_minimo: "minimum_stock" };
  return headers.map(header => {
    const key = importFieldKey(header);
    const target = aliases[key] || (importTargets.some(([id]) => id === key && id !== "custom" && id !== "ignore") ? key : "custom");
    const matchingLabels = fields.filter(f => importFieldKey(f.label) === key);
    const field = fields.find(f => f.key === key) || (matchingLabels.length === 1 ? matchingLabels[0] : undefined);
    return { target, key: field?.key || key, type: field?.type || coreImportFields[target]?.type || "text" };
  });
}
