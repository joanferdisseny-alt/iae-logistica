import Link from "next/link";
import { redirect } from "next/navigation";
import { CreateItemModal, InventoryAlertsModal } from "@/app/dashboard/inventory/create-item-modal";
import { requireAccess } from "@/lib/auth/context";
import { CatalogTable } from "../templates/catalog-table";
import { currentInventoryStatus, filterInventoryStatus, inventoryToday } from "@/lib/inventory/expiry-status";
import { categoryBranch, categoryOptions, type InventoryCategory } from "@/lib/inventory/categories";
import { sizeTotals, type SizeVariant } from "@/lib/inventory/size-catalog";

export const dynamic = "force-dynamic";

type InventoryRow = {
  id: string;
  name: string;
  category: string;
  subtype: string | null;
  current_stock: number;
  minimum_stock: number | null;
  unit: string | null;
  status: string;
  operational_status: string | null;
  expiration_date: string | null;
  maintenance_due_at: string | null;
  headquarters_id: string | null;
  item_ids: string[];
  is_size_group: boolean;
  size_count: number;
  variants: SizeVariant[];
};

type HeadquartersRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type LocationOptionRow = {
  id: string;
  name: string;
  code: string | null;
  headquarters_id: string | null;
  parent_location_id: string | null;
};

function statusBadge(status: string) {
  if (status === "ok") return "ec-badge-ok";
  if (status === "low") return "ec-badge-warn";
  return "ec-badge-bad";
}

const PAGE_SIZE = 50;
const statusLabels: Record<string, string> = {
  ok: "Correcto", low: "Stock bajo", expired: "Caducado", maintenance: "Mantenimiento"
};
const operationalLabels: Record<string, string> = {
  available: "Disponible", in_use: "En uso", repair: "En reparación",
  inspection: "En inspección", retired: "Retirado", mixed: "Varios estados"
};

// Fetch every RLS-visible option, rather than silently accepting the API row limit.
async function readAll<T>(query: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const response = await query(from, from + 499);
    if (response.error || !response.data) {
      return { data: rows, error: response.error ?? { message: "Respuesta sin datos" } };
    }
    rows.push(...response.data);
    if (response.data.length < 500) return { data: rows, error: null };
  }
}

function InventoryError({ message }: { message: string }) {
  return (
    <section className="ec-card"><div className="ec-card-body ec-stack">
      <h1 className="ec-h1">Inventario no disponible</h1>
      <p className="ec-error" role="alert">{message}</p>
      <Link className="ec-btn" href="/dashboard/inventory">Volver a cargar</Link>
    </div></section>
  );
}

export default async function InventoryPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, profile, roleCode, isAdmin } = await requireAccess();
  if (!profile.is_active || (!isAdmin && !profile.headquarters_id)) {
    return <InventoryError message="Acceso bloqueado: necesitas un perfil activo con sede asignada. Contacta con un administrador." />;
  }
  const params = await searchParams;
  const param = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const q = param("q").slice(0, 120);
  const category = param("category");
  const status = param("status");
  const today = inventoryToday();
  const operationalStatus = param("operational_status");
  const headquartersFilter = isAdmin ? param("headquarters") : profile.headquarters_id;
  if ((status && !Object.hasOwn(statusLabels, status)) ||
      (operationalStatus && !Object.hasOwn(operationalLabels, operationalStatus)) ||
      (headquartersFilter && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headquartersFilter))) {
    return <InventoryError message="Hay un filtro de estado o sede no válido. Restablece los filtros para continuar." />;
  }
  const requestedPage = Number(param("page") || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 42949672 ? requestedPage : 1;
  const pageHref = (target: number) => {
    const values = new URLSearchParams();
    for (const [key, value] of Object.entries({ q, category, status, operational_status: operationalStatus, headquarters: isAdmin ? headquartersFilter : "" })) {
      if (value) values.set(key, value);
    }
    values.set("page", String(target));
    return `/dashboard/inventory?${values.toString()}`;
  };
  const canManage = ["admin", "editor", "operator"].includes(roleCode);
  const userHeadquartersId = profile.headquarters_id;
  const categoriesPromise = readAll((from, to) => supabase.from("inventory_categories")
    .select("code, name, parent_code").order("name").order("code").range(from, to).returns<InventoryCategory[]>());
  const itemsQuery = supabase
    .from("inventory_catalog_items")
    .select(
      "id, item_ids, name, category, subtype, current_stock, minimum_stock, unit, status, operational_status, expiration_date, maintenance_due_at, headquarters_id, is_size_group, size_count, variants",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) itemsQuery.ilike("search_text", `%${q.replace(/[\\%_*]/g, "\\$&")}%`);
  filterInventoryStatus(itemsQuery, status, today);
  if (operationalStatus === "mixed") itemsQuery.eq("operational_status", "mixed");
  else if (operationalStatus) itemsQuery.contains("operational_statuses", [operationalStatus]);
  if (headquartersFilter) itemsQuery.eq("headquarters_id", headquartersFilter);
  const headquartersQuery = supabase
    .from("headquarters")
    .select("id, name, is_active")
    .order("name", { ascending: true }).order("id");
  const locationsQuery = supabase
    .from("locations")
    .select("id, name, code, headquarters_id, parent_location_id")
    .order("name", { ascending: true }).order("id");

  if (!isAdmin) {
    headquartersQuery.eq("id", userHeadquartersId);
    locationsQuery.eq("headquarters_id", userHeadquartersId);
  }

  const [itemsResponse, headquartersResponse, locationsResponse, categoriesResponse] = await Promise.all([
    category ? categoriesPromise.then(response => itemsQuery
      .in("category", categoryBranch(category, response.data)).returns<InventoryRow[]>()) : itemsQuery.returns<InventoryRow[]>(),
    readAll((from, to) => headquartersQuery.range(from, to).returns<HeadquartersRow[]>()),
    readAll((from, to) => locationsQuery.range(from, to).returns<LocationOptionRow[]>()),
    categoriesPromise
  ]);

  // PostgREST may reject a stale/out-of-range offset before returning its count.
  if (itemsResponse.error?.code === "PGRST103") {
    const countQuery = supabase.from("inventory_catalog_items").select("id", { count: "exact", head: true });
    if (q) countQuery.ilike("search_text", `%${q.replace(/[\\%_*]/g, "\\$&")}%`);
    if (category) countQuery.in("category", categoryBranch(category, categoriesResponse.data));
    filterInventoryStatus(countQuery, status, today);
    if (operationalStatus === "mixed") countQuery.eq("operational_status", "mixed");
    else if (operationalStatus) countQuery.contains("operational_statuses", [operationalStatus]);
    if (headquartersFilter) countQuery.eq("headquarters_id", headquartersFilter);
    const response = await countQuery;
    if (!response.error && response.count !== null) {
      const lastPage = Math.max(1, Math.ceil(response.count / PAGE_SIZE));
      if (page > lastPage) redirect(pageHref(lastPage));
    }
  }
  const failures = [
    ["artículos", itemsResponse.error], ["sedes", headquartersResponse.error],
    ["ubicaciones", locationsResponse.error],
    ["categorías", categoriesResponse.error]
  ] as const;
  const failed = failures.filter(([, error]) => error);
  if (failed.length || !itemsResponse.data || itemsResponse.count === null) {
    console.error("Inventory read failed", failed);
    if (["PGRST205", "42P01"].includes(itemsResponse.error?.code ?? "")) {
      return <InventoryError message={isAdmin
        ? "Falta actualizar el catálogo por tallas. Ejecuta supabase/upgrade-size-catalog.sql en SQL Editor del proyecto Supabase de esta aplicación. No vuelvas a importar el Excel: el stock existente se conserva."
        : "El catálogo necesita una actualización. Contacta con un administrador."} />;
    }
    if (categoriesResponse.error?.message.includes("parent_code")) {
      return <InventoryError message={isAdmin
        ? "Falta actualizar las categorías de la base de datos. Ejecuta supabase/upgrade-category-hierarchy.sql en SQL Editor del proyecto Supabase configurado en la aplicación."
        : "La base de datos necesita una actualización. Contacta con un administrador."} />;
    }
    if (itemsResponse.error?.code === "42703" && itemsResponse.error.message.includes("operational_status")) {
      return <InventoryError message={isAdmin
        ? "La base de datos no está actualizada: falta el campo de estado operativo. Ejecuta el archivo supabase/upgrade-2026-09-14.sql completo en SQL Editor del mismo proyecto Supabase configurado en la aplicación. Después vuelve a cargar esta página. No uses install.sql sobre la base existente."
        : "La base de datos necesita una actualización. Pide a un administrador que aplique la migración pendiente; reintentar no resolverá este error."} />;
    }
    return <InventoryError message={`No se han podido cargar ${failed.map(([name]) => name).join(", ") || "los artículos y su recuento"}. No se muestra un listado parcial. Vuelve a intentarlo o contacta con un administrador.`} />;
  }
  const items = itemsResponse.data.map(item => ({ ...item, status: currentInventoryStatus(item, today) }));
  type StockRow = { item_id: string; quantity: number; location_id: string | null; inventory_containers: { name: string; code: string | null; location_id: string | null } | null };
  const itemIds = items.flatMap(item => item.item_ids);
  const stockRows: StockRow[] = [];
  for (let start = 0; start < itemIds.length; start += 100) {
    const response = await readAll((from,to) => supabase.from("inventory_stock_positions")
      .select("item_id, quantity, location_id, inventory_containers(name, code, location_id)").in("item_id",itemIds.slice(start,start+100))
      .gt("quantity",0).order("id").range(from,to).returns<StockRow[]>());
    if (response.error) return <InventoryError message="No se pudo cargar el reparto de existencias. Comprueba supabase/upgrade-distributed-stock.sql." />;
    stockRows.push(...response.data);
  }
  const stockByItem = new Map<string,StockRow[]>();
  for (const stock of stockRows) {
    const rows = stockByItem.get(stock.item_id) ?? []; rows.push(stock); stockByItem.set(stock.item_id,rows);
  }
  const totalItems = itemsResponse.count;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (page > totalPages) redirect(pageHref(totalPages));
  const headquarters = headquartersResponse.data;
  const locations = locationsResponse.data;
  const categories = categoryOptions(categoriesResponse.data);
  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const locationPath = (id: string | null) => {
    if (!id) return "Sin ubicación";
    const names: string[] = [];
    const visited = new Set<string>();
    while (id) {
      if (visited.has(id)) { names.unshift("[Jerarquía circular]"); break; }
      visited.add(id);
      const location = locationsById.get(id);
      if (!location) { names.unshift("[Ubicación no accesible]"); break; }
      names.unshift(location.code ? `${location.name} · ${location.code}` : location.name);
      id = location.parent_location_id;
    }
    return names.join(" / ");
  };
  const effectiveLocation = (item: InventoryRow) => item.item_ids.flatMap(id => stockByItem.get(id) ?? []).map(stock => {
    const container = stock.inventory_containers;
    const size = item.is_size_group ? item.variants.find(variant => variant.id === stock.item_id)?.size : null;
    return `${size ? `Talla ${size}: ` : ""}${stock.quantity} ${item.unit ?? 'uds.'} · ${container ? `Caja: ${container.name} > ${locationPath(container.location_id)}` : locationPath(stock.location_id)}`;
  }).join("; ") || "Sin existencias";

  return (
    <div className="ec-page ec-inventory-page">
      <section className="ec-card">
        <div className="ec-card-header">
          <div className="ec-col">
            <div className="ec-row ec-row-wrap"><h1 className="ec-h1">Artículos</h1><span className="ec-badge ec-badge-neutral">{totalItems}</span></div>
            <span className="ec-help">Existencias, estado y ubicación de cada recurso. Las tallas de una prenda se reúnen en una sola ficha por sede.</span>
          </div>
          {canManage && <div className="ec-actions">
            <details className="ec-inventory-tools"><summary className="ec-btn">Otras acciones</summary><div className="ec-stack">
              <Link className="ec-btn" href="/dashboard/receiving">Recibir material</Link>
              {isAdmin && <Link className="ec-btn" href="/dashboard/imports">Importar stock</Link>}
              {isAdmin && <InventoryAlertsModal />}
            </div></details>
            <CreateItemModal />
          </div>}
        </div>
        <div className="ec-card-body ec-stack">
          <form action="/dashboard/inventory" method="get" className="ec-inventory-search">
            <label className="ec-label">Buscar por nombre
              <input className="ec-input" name="q" type="search" defaultValue={q} maxLength={120} placeholder="Nombre del artículo" />
            </label>
            <button className="ec-btn ec-btn-primary ec-search-submit" type="submit">Buscar</button>
            <details className="ec-inventory-filter-panel" open={Boolean(category || status || operationalStatus || (isAdmin && headquartersFilter))}>
              <summary>Filtros de categoría, estado y sede</summary>
              <div className="ec-inventory-filters">
            <label className="ec-label">Categoría
              <select className="ec-select" name="category" defaultValue={category}>
                <option value="">Todas</option>
                {category && !categories.some((entry) => entry.code === category) ? <option value={category}>{category} (no disponible)</option> : null}
                {categories.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
              </select>
              <span className="ec-help">Incluye sus subcategorías.</span>
            </label>
            <label className="ec-label">Alerta
              <select className="ec-select" name="status" defaultValue={status}>
                <option value="">Todas</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="ec-label">Estado operativo
              <select className="ec-select" name="operational_status" defaultValue={operationalStatus}>
                <option value="">Todos</option>
                {Object.entries(operationalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {isAdmin ? <label className="ec-label">Sede
              <select className="ec-select" name="headquarters" defaultValue={headquartersFilter ?? ""}>
                <option value="">Todas las accesibles</option>
                {headquartersFilter && !headquarters.some((entry) => entry.id === headquartersFilter) ? <option value={headquartersFilter}>Sede no accesible</option> : null}
                {headquarters.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.is_active ? "" : " (inactiva)"}</option>)}
              </select>
            </label> : null}
            <div className="ec-actions">
              <button className="ec-btn ec-btn-primary" type="submit">Filtrar</button>
              <Link className="ec-btn" href="/dashboard/inventory">Limpiar</Link>
            </div>
              </div>
            </details>
          </form>
          <p className="ec-help" role="status">
            {totalItems ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalItems)} de ${totalItems} artículos` : "0 artículos con estos filtros"}.
            {" "}La búsqueda se realiza en todo el inventario accesible, no solo en esta página.
          </p>
          <div className="ec-inventory-catalog">
            <CatalogTable
              key={pageHref(page)}
              columns={[
                { label: "Artículo", className: "ec-inventory-name-column" },
                { label: "Stock", className: "ec-inventory-stock-column" },
                { label: "Alerta", className: "ec-inventory-alert-column" },
                { label: "Estado" }
              ]}
              caption="Selecciona un artículo para ver sus ubicaciones, fechas y abrir la ficha completa."
              emptyMessage="No hay artículos que coincidan con los filtros en las sedes accesibles."
              rows={items.map(item => ({
                id: item.id,
                label: item.name,
                cells: [
                  <span key="stock" className="ec-col"><span className="ec-template-count">{item.current_stock} {item.unit ?? "uds."}</span>{item.is_size_group && <span className="ec-help">{item.size_count} tallas</span>}</span>,
                  <span key="alert" className={`ec-badge ${statusBadge(item.status)}`}>{statusLabels[item.status] ?? item.status}</span>,
                  <span key="status" className={`ec-badge ${item.operational_status === "available" ? "ec-badge-ok" : item.operational_status === "repair" || item.operational_status === "inspection" ? "ec-badge-warn" : "ec-badge-neutral"}`}>
                    {item.operational_status ? operationalLabels[item.operational_status] ?? item.operational_status : "Sin informar"}
                  </span>
                ],
                details: <>
                  <div className="ec-template-detail-heading">
                    <div className="ec-template-description">
                      <strong>{categories.find(entry => entry.code === item.category)?.name ?? item.category}</strong>
                      {item.subtype && <p className="ec-muted">{item.subtype}</p>}
                    </div>
                    <div className="ec-actions ec-template-detail-tools">
                      <Link className="ec-btn ec-btn-primary" href={`/dashboard/inventory/${item.id}`}>Ver ficha completa</Link>
                    </div>
                  </div>
                  <dl className="ec-inventory-detail-grid">
                    <div><dt>Sede</dt><dd>{headquarters.find(site => site.id === item.headquarters_id)?.name ?? "Sede no accesible"}</dd></div>
                    <div><dt>Stock mínimo</dt><dd>{item.minimum_stock !== null ? `${item.minimum_stock} ${item.unit ?? "uds."}` : "Sin configurar"}</dd></div>
                    <div><dt>Caducidad</dt><dd>{item.expiration_date ?? "Sin fecha"}</dd></div>
                    <div><dt>Mantenimiento</dt><dd>{item.maintenance_due_at ?? "Sin fecha"}</dd></div>
                    <div className="ec-inventory-detail-locations"><dt>Ubicaciones y cantidades</dt><dd>{effectiveLocation(item)}</dd></div>
                  </dl>
                  {item.is_size_group && <div className="ec-table-wrap"><table className="ec-table">
                    <caption className="ec-help">Existencias por talla</caption>
                    <thead><tr><th scope="col">Talla</th><th scope="col">Unidades</th></tr></thead>
                    <tbody>{sizeTotals(item.variants).map(variant => <tr key={variant.size}><th scope="row">{variant.size}</th><td>{variant.quantity}</td></tr>)}</tbody>
                  </table></div>}
                </>
              }))}
            />
          </div>
          <nav className="ec-row ec-row-between ec-row-wrap" aria-label="Paginación de inventario">
            {page > 1 ? <Link className="ec-btn" href={pageHref(page - 1)} rel="prev">Anterior</Link> : <span className="ec-help">Primera página</span>}
            <span className="ec-help">Página {page} de {totalPages} · {PAGE_SIZE} por página</span>
            {page < totalPages ? <Link className="ec-btn" href={pageHref(page + 1)} rel="next">Siguiente</Link> : <span className="ec-help">Última página</span>}
          </nav>
        </div>
      </section>
    </div>
  );
}
