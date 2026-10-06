import type { InventoryCategory } from "./categories";

export type CatalogCategoryNode = InventoryCategory & { ancestors: string[]; path: string; hasChildren: boolean };
export type CatalogFilters = { category?: string; q?: string; headquarters?: string; page?: number };

export function catalogHref(filters: CatalogFilters = {}) {
  const params = new URLSearchParams();
  for (const key of ["category", "q", "headquarters"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return `/dashboard/catalog${params.size ? `?${params}` : ""}`;
}

// Build an iterative, ordered tree. Missing parents remain visible at the root;
// cycles fail explicitly instead of hiding whole branches or hanging rendering.
export function catalogCategoryNodes(categories: InventoryCategory[]): CatalogCategoryNode[] {
  const byCode = new Map(categories.map(category => [category.code, category]));
  const children = new Map<string | null, InventoryCategory[]>();
  for (const category of categories) {
    const parent = category.parent_code && byCode.has(category.parent_code) ? category.parent_code : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(category); children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.name.localeCompare(b.name, "es") || a.code.localeCompare(b.code));
  const pending = (children.get(null) ?? []).map(category => ({ category, ancestors: [] as string[], names: [] as string[] })).reverse();
  const nodes: CatalogCategoryNode[] = [];
  const seen = new Set<string>();
  while (pending.length) {
    const { category, ancestors, names } = pending.pop()!;
    if (seen.has(category.code)) throw Error("Jerarquía de categorías no válida.");
    seen.add(category.code);
    const branch = children.get(category.code) ?? [];
    nodes.push({ ...category, ancestors, path: [...names, category.name].join(" / "), hasChildren: branch.length > 0 });
    for (const child of [...branch].reverse()) pending.push({ category: child, ancestors: [...ancestors, category.code], names: [...names, category.name] });
  }
  if (seen.size !== categories.length) throw Error("Jerarquía de categorías no válida.");
  return nodes;
}
