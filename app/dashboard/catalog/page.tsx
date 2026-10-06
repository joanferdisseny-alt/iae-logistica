import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { categoryBranch, type InventoryCategory } from "@/lib/inventory/categories";
import { catalogCategoryNodes, catalogHref, type CatalogCategoryNode } from "@/lib/inventory/catalog-browser";
import { sizeTotals, type SizeVariant } from "@/lib/inventory/size-catalog";
import { CategoryTree } from "./category-tree";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type Site = { id: string; name: string };
type Product = {
  id: string; name: string; category: string; headquarters_id: string; current_stock: number;
  unit: string | null; status: string; is_size_group: boolean; size_count: number; variants: SizeVariant[];
};
const statuses: Record<string, string> = { ok: "Correcto", low: "Stock bajo", expired: "Caducado", maintenance: "Mantenimiento" };

function CatalogError({ message }: { message: string }) {
  return <section className="ec-card"><div className="ec-card-body ec-stack">
    <h1 className="ec-h1">Catálogo no disponible</h1><p className="ec-error" role="alert">{message}</p>
    <Link className="ec-btn" href="/dashboard/catalog">Volver al catálogo</Link>
  </div></section>;
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile, isAdmin } = await requireAccess();
  if (!profile.is_active || (!isAdmin && !profile.headquarters_id)) return <CatalogError message="Necesitas un perfil activo y una sede asignada. Contacta con un administrador." />;
  const params = await searchParams;
  const param = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key])?.trim() ?? "";
  const category = param("category");
  const q = param("q").slice(0, 120);
  const headquarters = isAdmin ? param("headquarters") : profile.headquarters_id!;
  if (headquarters && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headquarters)) return <CatalogError message="La sede seleccionada no es válida. Restablece los filtros." />;
  const requested = Number(param("page") || 1);
  const page = Number.isSafeInteger(requested) && requested > 0 && requested <= 42949672 ? requested : 1;
  const filters = { category, q, headquarters: isAdmin ? headquarters : "" };
  let categories: InventoryCategory[], sites: Site[], nodes: CatalogCategoryNode[];
  try {
    [categories, sites] = await Promise.all([
      readAllRows((from, to) => supabase.from("inventory_categories").select("code, name, parent_code").order("name").order("code").range(from, to).returns<InventoryCategory[]>()),
      readAllRows((from, to) => {
        const query = supabase.from("headquarters").select("id, name").order("name").order("id").range(from, to);
        if (!isAdmin) query.eq("id", profile.headquarters_id);
        return query.returns<Site[]>();
      })
    ]);
    nodes = catalogCategoryNodes(categories);
  } catch {
    return <CatalogError message="No se han podido cargar las categorías y sedes completas. Comprueba la conexión y la jerarquía de categorías; no se muestra un catálogo parcial." />;
  }
  const selected = nodes.find(node => node.code === category);
  if (category && !selected) return <CatalogError message="Esta categoría ya no existe o no está disponible. Vuelve al catálogo para elegir otra." />;
  if (headquarters && !sites.some(site => site.id === headquarters)) return <CatalogError message="La sede seleccionada ya no está disponible." />;
  const branch = category ? categoryBranch(category, categories) : [];
  const query = (head = false) => {
    const result = supabase.from("inventory_catalog_items").select(head ? "id" : "id, name, category, headquarters_id, current_stock, unit, status, is_size_group, size_count, variants", { count: "exact", head });
    if (category) result.in("category", branch);
    if (headquarters) result.eq("headquarters_id", headquarters);
    if (q) result.ilike("search_text", `%${q.replace(/[\\%_*]/g, "\\$&")}%`);
    return result;
  };
  const response = await query().order("category").order("name").order("id").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1).returns<Product[]>();
  if (response.error?.code === "PGRST103") {
    const countResponse = await query(true);
    if (!countResponse.error && countResponse.count !== null) redirect(catalogHref({ ...filters, page: Math.max(1, Math.ceil(countResponse.count / PAGE_SIZE)) }));
  }
  if (response.error || !response.data || response.count === null) return <CatalogError message={isAdmin && ["42P01", "PGRST205"].includes(response.error?.code ?? "")
    ? "Falta actualizar el catálogo agrupado: ejecuta supabase/upgrade-size-catalog.sql en Supabase. No vuelvas a importar el Excel."
    : "No se han podido cargar los artículos completos. Vuelve a intentarlo; no se muestran resultados parciales."} />;
  const total = response.count;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages) redirect(catalogHref({ ...filters, page: totalPages }));
  const children = nodes.filter(node => category ? node.parent_code === category : node.ancestors.length === 0);
  const trail = selected ? [...selected.ancestors, selected.code].map(code => nodes.find(node => node.code === code)!) : [];
  const groups = new Map<string, Product[]>();
  for (const product of response.data) {
    const products = groups.get(product.category) ?? [];
    products.push(product); groups.set(product.category, products);
  }
  const inventoryParams = new URLSearchParams();
  if (category) inventoryParams.set("category", category);
  if (q) inventoryParams.set("q", q);
  if (isAdmin && headquarters) inventoryParams.set("headquarters", headquarters);

  return <div className="ec-page ec-catalog-explorer">
    <section className="ec-card">
      <div className="ec-card-header ec-row-wrap">
        <div className="ec-col"><h1 className="ec-h1">Explorar catálogo</h1><span className="ec-help">Categorías, subcategorías y artículos, en un mismo lugar.</span></div>
        <Link className="ec-btn" href={`/dashboard/inventory${inventoryParams.size ? `?${inventoryParams}` : ""}`}>Gestionar artículos</Link>
      </div>
      <form className="ec-card-body ec-catalog-filters" method="get" action="/dashboard/catalog">
        {category && <input type="hidden" name="category" value={category} />}
        <label className="ec-label">Buscar artículos<input className="ec-input" type="search" name="q" defaultValue={q} maxLength={120} placeholder="Nombre de artículo o prenda…" /></label>
        {isAdmin ? <label className="ec-label">Sede<select className="ec-select" name="headquarters" defaultValue={headquarters}>
          <option value="">Todas las sedes</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select></label> : <p className="ec-help">Sede: {sites[0]?.name ?? "Sede asignada"}</p>}
        <button className="ec-btn ec-btn-primary" type="submit">Buscar</button>
        {(q || (isAdmin && headquarters)) && <Link className="ec-btn" href={catalogHref({ category })}>Limpiar filtros</Link>}
      </form>
    </section>
    <div className="ec-catalog-layout">
      <CategoryTree key={category} nodes={nodes} filters={filters} />
      <div className="ec-catalog-content ec-stack">
        <nav className="ec-catalog-trail" aria-label="Ruta de categorías">
          <Link prefetch={false} href={catalogHref({ ...filters, category: "" })} aria-current={!category ? "page" : undefined}>Todo el catálogo</Link>
          {trail.map(node => <span key={node.code}><span aria-hidden="true">/</span><Link prefetch={false} href={catalogHref({ ...filters, category: node.code })} aria-current={node.code === category ? "page" : undefined}>{node.name}</Link></span>)}
        </nav>
        {children.length > 0 && <section aria-label={category ? "Subcategorías" : "Categorías principales"}>
          <h2 className="ec-h2">{category ? `Dentro de ${selected!.name}` : "Categorías principales"}</h2>
          <div className="ec-catalog-folders">{children.map(child => <Link prefetch={false} className="ec-catalog-folder" key={child.code} href={catalogHref({ ...filters, category: child.code })}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7V5h6l3 3h9v12H3V7Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            <span><strong>{child.name}</strong><small>{child.hasChildren ? "Subcategorías y artículos" : "Ver artículos"}</small></span>
            <span aria-hidden="true">›</span>
          </Link>)}</div>
        </section>}
        <div className="ec-col">
          <h2 className="ec-h2">{selected ? `Artículos de ${selected.name}` : "Todos los artículos"}</h2>
          <p className="ec-help" role="status">{total ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} de ${total} artículos` : "0 artículos"}{category ? ", incluidas sus subcategorías" : ""}. La búsqueda recorre todo el catálogo accesible, no solo esta página.</p>
        </div>
        {!total && <section className="ec-card"><div className="ec-card-body ec-stack">
          <p className="ec-muted">{q ? "No hay artículos que coincidan con esta búsqueda." : "Todavía no hay artículos en esta selección. Las categorías vacías siguen disponibles para organizar el catálogo."}</p>
          <Link className="ec-btn" href={catalogHref({ headquarters: filters.headquarters })}>Ver todo el catálogo</Link>
        </div></section>}
        {[...groups].map(([code, products]) => <section className="ec-card ec-catalog-products" key={code} aria-label={nodes.find(node => node.code === code)?.path ?? code}>
          <div className="ec-card-header"><h3 className="ec-h3"><Link prefetch={false} href={catalogHref({ ...filters, category: code })}>{nodes.find(node => node.code === code)?.path ?? code}</Link></h3></div>
          <ul>{products.map(product => <li className="ec-catalog-product" key={product.id}>
            <div className="ec-catalog-product-main"><Link className="ec-link-strong" prefetch={false} href={`/dashboard/inventory/${product.id}`}>{product.name}</Link>
              <span className="ec-help">{sites.find(site => site.id === product.headquarters_id)?.name ?? "Sede no disponible"}{product.is_size_group ? ` · ${product.size_count} ${product.size_count === 1 ? "talla" : "tallas"}` : ""}</span>
              {product.is_size_group && <span className="ec-catalog-size-line">{sizeTotals(product.variants).map(size => `${size.size}: ${size.quantity}`).join(" · ")}</span>}
            </div>
            <div className="ec-catalog-product-stock"><strong>{product.current_stock} {product.unit ?? "uds."}</strong>
              <span className={`ec-badge ${product.status === "ok" ? "ec-badge-ok" : product.status === "low" ? "ec-badge-warn" : "ec-badge-bad"}`}>{statuses[product.status] ?? product.status}</span>
            </div>
            <Link className="ec-btn" prefetch={false} href={`/dashboard/inventory/${product.id}`} aria-label={`Abrir ficha de ${product.name}`}>Ver ficha</Link>
          </li>)}</ul>
        </section>)}
        {total > 0 && <nav className="ec-row ec-row-between ec-row-wrap" aria-label="Paginación del catálogo">
          {page > 1 ? <Link className="ec-btn" href={catalogHref({ ...filters, page: page - 1 })} rel="prev">Anterior</Link> : <span className="ec-help">Primera página</span>}
          <span className="ec-help">Página {page} de {totalPages}</span>
          {page < totalPages ? <Link className="ec-btn" href={catalogHref({ ...filters, page: page + 1 })} rel="next">Siguiente</Link> : <span className="ec-help">Última página</span>}
        </nav>}
      </div>
    </div>
  </div>;
}
