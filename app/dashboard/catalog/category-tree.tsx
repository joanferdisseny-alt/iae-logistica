"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { catalogHref, type CatalogCategoryNode, type CatalogFilters } from "@/lib/inventory/catalog-browser";

export function CategoryTree({ nodes, filters }: { nodes: CatalogCategoryNode[]; filters: CatalogFilters }) {
  const selected = nodes.find(node => node.code === filters.category);
  const [expanded, setExpanded] = useState<string[]>(selected ? [...selected.ancestors, selected.code] : []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const panelId = useId();
  const visible = nodes.filter(node => node.ancestors.every(code => expanded.includes(code)));
  return <aside className="ec-catalog-tree">
    <button className="ec-btn ec-catalog-tree-toggle" type="button" aria-expanded={mobileOpen} aria-controls={panelId} onClick={() => setMobileOpen(!mobileOpen)}>
      Categorías <span>{mobileOpen ? "Ocultar" : "Mostrar"}</span>
    </button>
    <nav id={panelId} className={`ec-catalog-tree-panel${mobileOpen ? " is-open" : ""}`} aria-label="Categorías del catálogo">
      <h2 className="ec-h3">Categorías</h2>
      <Link href={catalogHref({ ...filters, category: "", page: 1 })} prefetch={false} className="ec-catalog-tree-all" aria-current={!selected ? "page" : undefined} onClick={() => setMobileOpen(false)}>Todo el catálogo</Link>
      <ul>{visible.map(node => <li key={node.code} style={{ paddingLeft: `${Math.min(node.ancestors.length, 5) * 12}px` }}>
        {node.hasChildren ? <button type="button" className="ec-catalog-branch-toggle" aria-expanded={expanded.includes(node.code)} aria-label={`Subcategorías de ${node.name}`}
          onClick={() => setExpanded(current => current.includes(node.code) ? current.filter(code => code !== node.code) : [...current, node.code])}>
          <span aria-hidden="true">{expanded.includes(node.code) ? "−" : "+"}</span>
        </button> : <span className="ec-catalog-leaf" aria-hidden="true" />}
        <Link prefetch={false} href={catalogHref({ ...filters, category: node.code, page: 1 })} aria-current={node.code === filters.category ? "page" : undefined} title={node.path} onClick={() => setMobileOpen(false)}>{node.name}</Link>
      </li>)}</ul>
      {!nodes.length && <p className="ec-help">Todavía no hay categorías.</p>}
    </nav>
  </aside>;
}
