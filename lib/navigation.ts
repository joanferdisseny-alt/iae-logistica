export type WorkspaceLink = { href: string; label: string; adminOnly?: boolean };
export type WorkspaceArea = { id: string; label: string; icon: "box" | "pin" | "users" | "settings"; links: WorkspaceLink[] };

const areas: WorkspaceArea[] = [
  { id: "catalog", label: "Catálogo", icon: "box", links: [
    { href: "/dashboard/catalog", label: "Explorar catálogo" },
    { href: "/dashboard/inventory", label: "Artículos" },
    { href: "/dashboard/templates/categories", label: "Categorías", adminOnly: true },
    { href: "/dashboard/templates", label: "Tipos de artículo", adminOnly: true },
    { href: "/dashboard/templates/fields", label: "Campos", adminOnly: true },
    { href: "/dashboard/imports", label: "Importar stock", adminOnly: true }
  ] },
  { id: "warehouse", label: "Almacén", icon: "pin", links: [
    { href: "/dashboard/receiving", label: "Recibir material" },
    { href: "/dashboard/locations", label: "Cajas y kits" },
    { href: "/dashboard/locations/physical", label: "Ubicaciones físicas" },
    { href: "/dashboard/checklists", label: "Checklists" },
    { href: "/dashboard/requests", label: "Solicitudes" }
  ] },
  { id: "people", label: "Personas", icon: "users", links: [
    { href: "/dashboard/volunteers", label: "Voluntarios y entregas", adminOnly: true },
    { href: "/dashboard/personal", label: "Mi material" }
  ] },
  { id: "settings", label: "Configuración", icon: "settings", links: [
    { href: "/dashboard/headquarters", label: "Sedes", adminOnly: true },
    { href: "/dashboard/users", label: "Usuarios y permisos", adminOnly: true }
  ] }
];

export function workspaceAreas(role: string): WorkspaceArea[] {
  if (role === "volunteer") return [{ id: "personal", label: "Mi espacio", icon: "users", links: [
    { href: "/dashboard/personal", label: "Mi material" },
    { href: "/dashboard/requests", label: "Mis solicitudes" }
  ] }];
  return areas.map(area => ({ ...area, links: area.links.filter(link => !link.adminOnly || role === "admin") }))
    .filter(area => area.links.length);
}

// Prefer the most specific route: physical locations must not activate the boxes tab.
export function currentWorkspaceLink(visible: WorkspaceArea[], pathname: string) {
  const sectionPath = pathname.startsWith("/dashboard/stock/") ? "/dashboard/inventory" : pathname;
  return visible.flatMap(area => area.links.map(link => ({ area, link })))
    .filter(({ link }) => sectionPath === link.href || sectionPath.startsWith(`${link.href}/`))
    .sort((a, b) => b.link.href.length - a.link.href.length)[0];
}
