export const productSections = [
  { id: "overview", label: "Información", icon: "list" },
  { id: "sizes", label: "Tallas", icon: "template" },
  { id: "stock", label: "Existencias", icon: "box" },
  { id: "resources", label: "Documentos y compatibles", icon: "folder" },
  { id: "history", label: "Historial", icon: "check" }
] as const;

export type ProductSection = typeof productSections[number]["id"];

export function resolveProductSection(section: string | undefined, hasSizes: boolean, historyPage?: string): ProductSection {
  const value = section ?? (historyPage ? "history" : "overview");
  return productSections.some(tab => tab.id === value) && (value !== "sizes" || hasSizes)
    ? value as ProductSection : "overview";
}

export function productSectionHref(id: string, section: ProductSection, historyPage?: number) {
  const params = new URLSearchParams({ section });
  if (section === "history" && historyPage && historyPage > 1) params.set("historyPage", String(historyPage));
  return `/dashboard/inventory/${encodeURIComponent(id)}?${params}`;
}

export function legacyProductSection(hash: string): ProductSection | undefined {
  return ({ "#existencias": "stock", "#historial": "history", "#talla": "stock" } as const)[hash as "#existencias" | "#historial" | "#talla"];
}
