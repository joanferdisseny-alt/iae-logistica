import { z } from "zod";

export const memberTargets = [["ignore", "Ignorar"], ["email", "Correo (obligatorio)"], ["name", "Nombre completo (obligatorio)"], ["site", "Sede (nombre o ID)"], ["code", "Código de voluntario"]] as const;
export type MemberTarget = typeof memberTargets[number][0];
export type MemberRow = { email: string; name: string; site: string; code: string | null; role: "volunteer" };
export function suggestMemberTarget(header: string): MemberTarget {
  const key = header.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s_-]/g, "");
  if (["email", "mail", "correo", "correoelectronico"].includes(key)) return "email";
  if (["nombre", "nombrecompleto", "nombreyapellidos", "fullname", "name"].includes(key)) return "name";
  if (["sede", "site", "headquarters", "delegacion"].includes(key)) return "site";
  if (["codigo", "codigovoluntario", "numerosocio", "code", "externalcode"].includes(key)) return "code";
  return "ignore";
}
export function mapMembers(table: unknown, mapping: unknown, defaultSite: string, sites: { id: string; name: string }[]): MemberRow[] {
  const parsed = z.object({ headers: z.array(z.string().max(120)).min(1).max(40), rows: z.array(z.array(z.string().max(2000)).max(40)).min(1).max(500) }).parse(table);
  const columns = z.array(z.enum(["ignore", "email", "name", "site", "code"])).parse(mapping);
  if (columns.length !== parsed.headers.length || parsed.rows.some(r => r.length !== columns.length)) throw Error("Las columnas no coinciden con el archivo.");
  for (const key of ["email", "name", "site", "code"]) {
    const count = columns.filter(c => c === key).length;
    if (count > 1 || (["email", "name"].includes(key) && count !== 1)) throw Error("Asigna una única columna de correo y de nombre. No repitas destinos.");
  }
  const emails = new Set<string>(), codes = new Set<string>();
  return parsed.rows.map((cells, i) => {
    const get = (key: string) => (cells[columns.indexOf(key as MemberTarget)] ?? "").trim();
    const email = get("email").toLowerCase(), name = get("name"), code = get("code") || null;
    if (!z.string().email().max(254).safeParse(email).success || name.length < 2 || name.length > 160 || (code?.length ?? 0) > 80) throw Error(`Fila ${i + 2}: revisa nombre, correo obligatorio y código (máximo 80 caracteres).`);
    if (emails.has(email) || (code && codes.has(code))) throw Error(`Fila ${i + 2}: correo o código repetido. Usa una fila por persona, sin repetirla por cada prenda.`);
    emails.add(email); if (code) codes.add(code);
    const value = get("site") || defaultSite;
    const matches = sites.filter(s => s.id === value || s.name.trim().toLowerCase() === value.toLowerCase());
    if (matches.length !== 1) throw Error(`Fila ${i + 2}: sede desconocida o ambigua. Selecciona una sede general o usa su ID exacto.`);
    return { email, name, code, site: matches[0].id, role: "volunteer" };
  });
}
