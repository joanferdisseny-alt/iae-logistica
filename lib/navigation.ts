import type { IconName } from "@/app/dashboard/icons";

export type WorkspaceLink = { href: string; label: string; adminOnly?: boolean; icon?: IconName; keywords?: string };
export type WorkspaceArea = { id: string; label: string; icon: "box" | "pin" | "users" | "settings"; links: WorkspaceLink[] };

const areas: WorkspaceArea[] = [
  { id: "catalog", label: "Catálogo", icon: "box", links: [
    { href: "/dashboard/catalog", label: "Productos", icon: "catalog", keywords: "artículos inventario explorar catálogo" },
    { href: "/dashboard/templates/categories", label: "Categorías", icon: "folder", adminOnly: true },
    { href: "/dashboard/imports", label: "Importar stock", icon: "import", adminOnly: true }
  ] },
  { id: "warehouse", label: "Almacén", icon: "pin", links: [
    { href: "/dashboard/receiving", label: "Recibir material", icon: "scan" },
    { href: "/dashboard/locations", label: "Cajas y kits", icon: "box" },
    { href: "/dashboard/locations/physical", label: "Ubicaciones físicas", icon: "pin" },
    { href: "/dashboard/checklists", label: "Checklists", icon: "check" },
    { href: "/dashboard/requests", label: "Solicitudes", icon: "request" }
  ] },
  { id: "people", label: "Personas", icon: "users", links: [
    { href: "/dashboard/volunteers", label: "Voluntarios y entregas", icon: "users", adminOnly: true },
    { href: "/dashboard/personal", label: "Mi material", icon: "personal" }
  ] },
  { id: "settings", label: "Configuración", icon: "settings", links: [
    { href: "/dashboard/templates", label: "Plantillas de producto", icon: "template", keywords: "tipos fichas campos catálogo", adminOnly: true },
    { href: "/dashboard/templates/fields", label: "Campos", icon: "fields", adminOnly: true },
    { href: "/dashboard/headquarters", label: "Sedes", icon: "pin", adminOnly: true },
    { href: "/dashboard/users", label: "Usuarios y permisos", icon: "settings", adminOnly: true }
  ] }
];

export function workspaceAreas(role: string): WorkspaceArea[] {
  if (role === "volunteer") return [{ id: "personal", label: "Mi espacio", icon: "users", links: [
    { href: "/dashboard/personal", label: "Mi material", icon: "personal" },
    { href: "/dashboard/requests", label: "Mis solicitudes", icon: "request" }
  ] }];
  return areas.map(area => ({ ...area, links: area.links.filter(link => !link.adminOnly || role === "admin") }))
    .filter(area => area.links.length);
}

export function searchWorkspaceLinks(role: string, query: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return workspaceAreas(role).flatMap(area => area.links.map(link => ({ ...link, area: area.label })))
    .filter(link => words.every(word => normalize(`${link.label} ${link.area} ${link.keywords ?? ""}`).includes(word)));
}

// Prefer the most specific route: physical locations must not activate the boxes tab.
export function currentWorkspaceLink(visible: WorkspaceArea[], pathname: string) {
  const sectionPath = pathname === "/dashboard/inventory" || pathname.startsWith("/dashboard/inventory/") || pathname.startsWith("/dashboard/stock/") ? "/dashboard/catalog" : pathname;
  return visible.flatMap(area => area.links.map(link => ({ area, link })))
    .filter(({ link }) => sectionPath === link.href || sectionPath.startsWith(`${link.href}/`))
    .sort((a, b) => b.link.href.length - a.link.href.length)[0];
}
