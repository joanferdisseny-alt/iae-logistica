import { createHash } from "node:crypto";
import readXlsxFile from "read-excel-file/node";
import { parse } from "csv-parse/sync";

export const uniformitySizes = ["XS", "S", "M", "L", "XL", "XXL", "SIN TALLA"] as const;
export type UniformityRow = { section: "first" | "second"; garment: string; size: string; quantity: number; source: string };
export type UniformityPreview = { rows: UniformityRow[]; omitted: number; garments: number; total: number; fileHash: string };
const normalize = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : "";
const sectionFor = (value: unknown) => ({ "PRIMERA UNIFORMIDAD": "first", "SEGUNDA UNIFORMIDAD": "second" }[normalize(value)] as "first" | "second" | undefined);

// Bound the expanded ZIP before the Excel library allocates XML strings.
export function validateExcelArchive(buffer: Buffer) {
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || buffer.length < 22 || buffer.readUInt32LE(end) !== 0x06054b50) throw Error("El archivo Excel no es válido.");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), expanded = 0;
  if (count > 200 || offset >= end) throw Error("Excel demasiado complejo. Usa una hoja de datos sencilla.");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw Error("Excel no válido o formato ZIP no compatible.");
    expanded += buffer.readUInt32LE(offset + 24);
    if (expanded > 8_000_000) throw Error("El contenido del Excel supera el límite de 8 MB.");
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  if (offset !== end) throw Error("Excel no compatible. Guarda una copia en formato .xlsx estándar.");
}

export function parseUniformitySheets(sheets: { sheet: string; data: unknown[][] }[]) {
  if (!sheets.length || sheets.length > 10) throw Error("Selecciona un archivo con entre 1 y 10 hojas de datos.");
  const rows: UniformityRow[] = [], keys = new Set<string>();
  let omitted = 0;
  const append = (section: "first" | "second", garment: unknown, size: unknown, quantity: unknown, source: string) => {
    const label = normalize(garment), talla = normalize(size);
    if (label.length < 2 || label.length > 120 || !uniformitySizes.some(s => s === talla)) throw Error(`Prenda o talla no válida en ${source}.`);
    const key = `${section}|${label}|${talla}`;
    if (keys.has(key)) throw Error(`Prenda y talla duplicadas en ${source}: ${label}, ${talla}.`);
    keys.add(key);
    const blank = quantity === null || quantity === undefined || quantity === "";
    if (blank) { omitted++; return; }
    if (!blank && (typeof quantity !== "number" && (typeof quantity !== "string" || !/^\d+$/.test(quantity.trim())))) throw Error(`Cantidad no válida en ${source}. Usa unidades enteras.`);
    const amount = blank ? 0 : Number(quantity);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000) throw Error(`Cantidad fuera de rango en ${source}.`);
    rows.push({ section, garment: label, size: talla, quantity: amount, source });
  };
  for (const sheet of sheets) {
    if (sheet.data.length > 2000 || sheet.data.some(row => row.length > 20)) throw Error("Demasiadas filas o columnas. El límite es 2000 filas y 20 columnas por hoja.");
    let section: "first" | "second" | undefined, headers = false;
    const first = sheet.data.find(row => row.some(c => c !== null && c !== "" && c !== undefined));
    const flat = first?.slice(0, 4).map(normalize).join("|") === "UNIFORMIDAD|PRENDA|TALLA|CANTIDAD";
    for (const [index, row] of sheet.data.entries()) {
      if (row.every(c => c === null || c === "" || c === undefined)) continue;
      const source = `${sheet.sheet}!A${index + 1}`;
      if (flat) {
        if (row === first) continue;
        const group = sectionFor(row[0]);
        if (!group || row.slice(4).some(c => c !== null && c !== "" && c !== undefined)) throw Error(`Uniformidad o columnas desconocidas en ${source}.`);
        append(group, row[1], row[2], row[3], source); continue;
      }
      const group = sectionFor(row[0]);
      if (group) {
        if (row.slice(1).some(c => c !== null && c !== "" && c !== undefined)) throw Error(`Cabecera inesperada en ${source}.`);
        section = group; headers = false; continue;
      }
      if (section && !headers && uniformitySizes.every((s, i) => normalize(row[i + 1]) === s)) { headers = true; continue; }
      if (!section || !headers || row.slice(8).some(c => c !== null && c !== "" && c !== undefined)) throw Error(`Formato no reconocido en ${source}. Revisa las cabeceras y las tallas.`);
      uniformitySizes.forEach((size, i) => append(section!, row[0], size, row[i + 1], `${sheet.sheet}!${String.fromCharCode(66 + i)}${index + 1}`));
    }
  }
  if (!rows.length || rows.length > 2000) throw Error("La importación debe contener entre 1 y 2000 artículos con cantidad confirmada.");
  rows.sort((a, b) => `${a.section}|${a.garment}|${a.size}`.localeCompare(`${b.section}|${b.garment}|${b.size}`, "es"));
  return { rows, omitted, garments: new Set(rows.map(r => `${r.section}|${r.garment}`)).size, total: rows.reduce((sum, row) => sum + row.quantity, 0) };
}

export async function readUniformityFile(buffer: Buffer, filename: string): Promise<UniformityPreview> {
  if (!buffer.length || buffer.length > 1_000_000) throw Error("El archivo debe ocupar menos de 1 MB.");
  let sheets: { sheet: string; data: unknown[][] }[];
  if (/\.xlsx$/i.test(filename)) {
    validateExcelArchive(buffer);
    sheets = await readXlsxFile(buffer);
  } else if (/\.csv$/i.test(filename)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const firstLine = text.split(/\r?\n/, 1)[0];
    sheets = [{ sheet: "CSV", data: parse(text, { bom: true, delimiter: firstLine.includes(";") ? ";" : ",", skip_empty_lines: true, max_record_size: 10_000, trim: true }) }];
  } else throw Error("Usa un Excel .xlsx o un CSV UTF-8. No se admiten .xls ni archivos con macros.");
  return { ...parseUniformitySheets(sheets), fileHash: createHash("sha256").update(buffer).digest("hex") };
}
