import readXlsxFile from "read-excel-file/node";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { validateExcelArchive } from "../uniformity/import";
import { coreImportFields, importTargets, type ImportField, type ImportTable } from "./import-model";

const tableSchema = z.object({ headers: z.array(z.string().trim().min(1).max(120)).min(1).max(40), rows: z.array(z.array(z.string().max(2000)).max(40)).min(1).max(500) });
const mappingSchema = z.array(z.object({ target: z.string(), key: z.string().max(60), type: z.enum(["text", "textarea", "number", "date", "boolean", "select"]) })).max(40);
const reserved = new Set([...Object.values(coreImportFields).map(f => f.key), "item_name", "subtype", "location_id", "maintenance_due_at", "headquarters_id", "category", "template_id", "id"]);

export async function readInventoryFile(buffer: Buffer, filename: string): Promise<ImportTable> {
  if (!buffer.length || buffer.length > 1_000_000) throw Error("Usa un archivo de hasta 1 MB.");
  let data: unknown[][];
  if (/\.xlsx$/i.test(filename)) {
    validateExcelArchive(buffer);
    const sheets = (await readXlsxFile(buffer)).filter(s => s.data.some(r => r.some(c => c !== null && c !== "")));
    if (sheets.length !== 1) throw Error("El Excel general debe tener una sola hoja de datos, con las cabeceras en la primera fila.");
    data = sheets[0].data;
  } else if (/\.csv$/i.test(filename)) {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    // Parse candidate delimiters rather than counting separators inside quoted labels.
    const candidates: unknown[][][] = [];
    for (const delimiter of [";", ",", "\t"]) {
      try { candidates.push(parse(content, { delimiter, bom: true, skip_empty_lines: true, trim: true, max_record_size: 80000, to: 502 })); } catch { /* Try the next delimiter. */ }
    }
    data = candidates.sort((a, b) => (b[0]?.length || 0) - (a[0]?.length || 0))[0];
    if (!data) throw Error("CSV no válido. Usa UTF-8 y separador coma, punto y coma o tabulador.");
  } else throw Error("Selecciona un CSV UTF-8 o un Excel .xlsx sin macros.");
  if (data.length > 501 || data.some(row => row.length > 40)) throw Error("Máximo 500 artículos y 40 columnas por carga. Divide los archivos mayores.");
  const rows = data.map(row => row.map(cell => {
    if (cell instanceof Date) return cell.toISOString().slice(0, 10);
    if (cell == null) return "";
    if (!["string", "number", "boolean"].includes(typeof cell)) throw Error("Hay una celda no compatible.");
    return String(cell).trim();
  }));
  const headers = rows.shift() || [];
  if (rows.some(row => row.length > headers.length && row.slice(headers.length).some(Boolean))) throw Error("Hay datos en columnas sin cabecera.");
  const table = tableSchema.parse({ headers, rows: rows.filter(row => row.some(Boolean)).map(row => headers.map((_, i) => row[i] || "")) });
  if (new Set(headers.map(h => h.toLowerCase())).size !== headers.length) throw Error("Las cabeceras no pueden repetirse.");
  if (Buffer.byteLength(JSON.stringify(table)) > 600_000) throw Error("Demasiado contenido. Divide el archivo en cargas menores.");
  return table;
}

function numberValue(value: string, stock = false) {
  const normalized = value.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized) || !Number.isFinite(Number(normalized))) throw Error("número no válido (sin separador de miles)");
  if (stock && (!/^\d+(\.\d{1,3})?$/.test(normalized) || Number(normalized) > 1_000_000)) throw Error("cantidad entre 0 y 1.000.000, con hasta 3 decimales");
  return String(Number(normalized));
}
function typedValue(value: string, type: string) {
  if (type === "number") return numberValue(value);
  if (type === "date") {
    const date = new Date(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Error("fecha no válida; usa AAAA-MM-DD");
  }
  if (type === "boolean") {
    if (["true", "1", "si", "sí"].includes(value.toLowerCase())) return "true";
    if (["false", "0", "no"].includes(value.toLowerCase())) return "false";
    throw Error("booleano no válido; usa sí / no");
  }
  return value;
}
export function mapInventoryImport(rawTable: unknown, rawMapping: unknown) {
  const table = tableSchema.parse(rawTable), mapping = mappingSchema.parse(rawMapping);
  if (mapping.length !== table.headers.length || table.rows.some(r => r.length !== mapping.length)) throw Error("Las columnas no coinciden con el archivo.");
  if (!mapping.some(c => c.target === "quantity") || !mapping.some(c => ["name", "sku", "id"].includes(c.target))) throw Error("Asigna la cantidad y al menos nombre, SKU o ID.");
  const seen = new Set<string>(), fields: ImportField[] = [];
  for (const [i, column] of mapping.entries()) {
    if (!importTargets.some(([key]) => key === column.target)) throw Error("Destino de columna desconocido.");
    if (column.target === "ignore") continue;
    const key = column.target === "custom" ? column.key : column.target;
    if (seen.has(key)) throw Error(`Dos columnas se han asignado a ${key}.`);
    seen.add(key);
    if (column.target === "custom") {
      if (!/^[a-z][a-z0-9_]{0,59}$/.test(key) || reserved.has(key)) throw Error(`Clave de campo no válida o reservada: ${key}. Usa el dato específico del artículo.`);
      fields.push({ key, label: table.headers[i], type: column.type });
    } else if (coreImportFields[key]) fields.push(coreImportFields[key]);
  }
  const rows = table.rows.map((cells, index) => {
    const row: Record<string, string> = {}, specs: Record<string, string> = {};
    for (const [i, col] of mapping.entries()) {
      const value = cells[i].trim();
      if (col.target === "ignore") continue;
      if (!value) { if (col.target === "quantity") throw Error(`Fila ${index + 2}: indica una cantidad; vacío no equivale a cero.`); continue; }
      try {
        if (col.target === "custom") specs[col.key] = typedValue(value, col.type);
        else if (["quantity", "minimum_stock"].includes(col.target)) row[col.target] = numberValue(value, true);
        else row[col.target] = typedValue(value, coreImportFields[col.target]?.type || "text");
      } catch (error) { throw Error(`Fila ${index + 2}, ${table.headers[i]}: ${error instanceof Error ? error.message : "valor no válido"}.`); }
    }
    if (row.id && !z.string().uuid().safeParse(row.id).success) throw Error(`Fila ${index + 2}: el ID debe ser un UUID del artículo, no un código externo (usa SKU).`);
    if (!row.id && !row.sku && !row.name) throw Error(`Fila ${index + 2}: falta nombre, SKU o ID.`);
    if (row.subcategory && !row.category) throw Error(`Fila ${index + 2}: la subcategoría necesita una categoría.`);
    const category = [...(row.category ? [row.category] : []), ...(row.subcategory?.split(">") || [])].map(s => s.trim());
    if (category.length > 5 || category.some(c => !c || c.length > 120)) throw Error(`Fila ${index + 2}: ruta de categorías no válida (máximo 5 niveles).`);
    delete row.category; delete row.subcategory;
    return { ...row, category, specs, row: index + 2 };
  });
  return { fields, rows };
}
