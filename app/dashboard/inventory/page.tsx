import Link from "next/link";
import { redirect } from "next/navigation";
import { CreateItemModal } from "@/app/dashboard/inventory/create-item-modal";
import { NotificationPreferencesModal } from "@/app/dashboard/inventory/notification-preferences-form";
import type { InventoryTemplateDefinition } from "@/lib/inventory/templates";
import { requireAccess } from "@/lib/auth/context";

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
  location_id: string | null;
  expiration_date: string | null;
  maintenance_due_at: string | null;
  inventory_container_items: Array<{
    inventory_containers: { name: string; code: string | null; location_id: string | null } | null;
  }> | { inventory_containers: { name: string; code: string | null; location_id: string | null } | null } | null;
  headquarters: {
    name: string;
  } | null;
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

type ContainerOptionRow = {
  id: string;
  name: string;
  code: string | null;
  headquarters_id: string | null;
};

type NotificationPreferenceRow = {
  notification_email: string;
  expiry_warning_days: number;
  email_notifications_enabled: boolean;
};

type TemplateRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category_code: string;
  inventory_categories: {
    name: string;
  } | null;
  inventory_template_fields: Array<{
    is_required: boolean;
    sort_order: number;
    inventory_fields: {
      field_key: string;
      label: string;
      field_type: "text" | "number" | "date" | "textarea" | "select" | "boolean";
      options: string[];
    } | null;
  }>;
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
  inspection: "En inspección", retired: "Retirado"
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
  const { supabase, user, profile, roleCode, isAdmin } = await requireAccess();
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
  const canConfigureAlerts = isAdmin;
  const canChooseHeadquarters = isAdmin;
  const userHeadquartersId = profile.headquarters_id;
  const itemsQuery = supabase
    .from("inventory_items")
    .select(
      "id, name, category, subtype, current_stock, minimum_stock, unit, status, operational_status, location_id, expiration_date, maintenance_due_at, headquarters(name), inventory_container_items(inventory_containers(name, code, location_id))",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) itemsQuery.ilike("name", `%${q.replace(/[\\%_*]/g, "\\$&")}%`);
  if (category) itemsQuery.eq("category", category);
  if (status) itemsQuery.eq("status", status);
  if (operationalStatus) itemsQuery.eq("operational_status", operationalStatus);
  if (headquartersFilter) itemsQuery.eq("headquarters_id", headquartersFilter);
  const headquartersQuery = supabase
    .from("headquarters")
    .select("id, name, is_active")
    .order("name", { ascending: true }).order("id");
  const locationsQuery = supabase
    .from("locations")
    .select("id, name, code, headquarters_id, parent_location_id")
    .order("name", { ascending: true }).order("id");
  const containersQuery = supabase
    .from("inventory_containers")
    .select("id, name, code, headquarters_id")
    .order("name", { ascending: true }).order("id");

  if (!isAdmin) {
    headquartersQuery.eq("id", userHeadquartersId);
    locationsQuery.eq("headquarters_id", userHeadquartersId);
    containersQuery.eq("headquarters_id", userHeadquartersId);
  }

  const [
    itemsResponse,
    preferencesResponse,
    templatesResponse,
    headquartersResponse,
    locationsResponse,
    containersResponse,
    categoriesResponse
  ] = await Promise.all([
    itemsQuery.returns<InventoryRow[]>(),
    supabase
      .from("notification_preferences")
      .select("notification_email, expiry_warning_days, email_notifications_enabled")
      .eq("profile_id", user.id)
      .maybeSingle<NotificationPreferenceRow>(),
    readAll((from, to) => supabase
      .from("inventory_templates")
      .select(
        "id, code, name, description, category_code, inventory_categories(name), inventory_template_fields(is_required, sort_order, inventory_fields(field_key, label, field_type, options))"
      )
      .order("name", { ascending: true }).order("id").range(from, to)
      .returns<TemplateRow[]>()),
    readAll((from, to) => headquartersQuery.range(from, to).returns<HeadquartersRow[]>()),
    readAll((from, to) => locationsQuery.range(from, to).returns<LocationOptionRow[]>()),
    readAll((from, to) => containersQuery.range(from, to).returns<ContainerOptionRow[]>()),
    readAll((from, to) => supabase.from("inventory_categories").select("code, name")
      .order("name").order("code").range(from, to).returns<Array<{ code: string; name: string }>>())
  ]);

  // PostgREST may reject a stale/out-of-range offset before returning its count.
  if (itemsResponse.error?.code === "PGRST103") {
    const countQuery = supabase.from("inventory_items").select("id", { count: "exact", head: true });
    if (q) countQuery.ilike("name", `%${q.replace(/[\\%_*]/g, "\\$&")}%`);
    if (category) countQuery.eq("category", category);
    if (status) countQuery.eq("status", status);
    if (operationalStatus) countQuery.eq("operational_status", operationalStatus);
    if (headquartersFilter) countQuery.eq("headquarters_id", headquartersFilter);
    const response = await countQuery;
    if (!response.error && response.count !== null) {
      const lastPage = Math.max(1, Math.ceil(response.count / PAGE_SIZE));
      if (page > lastPage) redirect(pageHref(lastPage));
    }
  }
  const failures = [
    ["artículos", itemsResponse.error], ["preferencias de avisos", preferencesResponse.error],
    ["plantillas", templatesResponse.error], ["sedes", headquartersResponse.error],
    ["ubicaciones", locationsResponse.error], ["cajas", containersResponse.error],
    ["categorías", categoriesResponse.error]
  ] as const;
  const failed = failures.filter(([, error]) => error);
  if (failed.length || !itemsResponse.data || itemsResponse.count === null) {
    console.error("Inventory read failed", failed);
    if (itemsResponse.error?.code === "42703" && itemsResponse.error.message.includes("operational_status")) {
      return <InventoryError message={isAdmin
        ? "La base de datos no está actualizada: falta el campo de estado operativo. Ejecuta el archivo supabase/upgrade-2026-09-14.sql completo en SQL Editor del mismo proyecto Supabase configurado en la aplicación. Después vuelve a cargar esta página. No uses install.sql sobre la base existente."
        : "La base de datos necesita una actualización. Pide a un administrador que aplique la migración pendiente; reintentar no resolverá este error."} />;
    }
    return <InventoryError message={`No se han podido cargar ${failed.map(([name]) => name).join(", ") || "los artículos y su recuento"}. No se muestra un listado parcial. Vuelve a intentarlo o contacta con un administrador.`} />;
  }
  const items = itemsResponse.data;
  type StockRow = { item_id: string; quantity: number; location_id: string | null; inventory_containers: { name: string; code: string | null; location_id: string | null } | null };
  const stockResponse = items.length ? await readAll((from,to) => supabase.from("inventory_stock_positions")
    .select("item_id, quantity, location_id, inventory_containers(name, code, location_id)").in("item_id",items.map(i => i.id))
    .gt("quantity",0).order("id").range(from,to).returns<StockRow[]>()) : { data: [] as StockRow[], error: null };
  if (stockResponse.error) return <InventoryError message="No se pudo cargar el reparto de existencias. Comprueba supabase/upgrade-distributed-stock.sql." />;
  const stockByItem = new Map<string,StockRow[]>();
  for (const stock of stockResponse.data) {
    const rows = stockByItem.get(stock.item_id) ?? []; rows.push(stock); stockByItem.set(stock.item_id,rows);
  }
  const totalItems = itemsResponse.count;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (page > totalPages) redirect(pageHref(totalPages));
  const templates = templatesResponse.data;
  const headquarters = headquartersResponse.data;
  const locations = locationsResponse.data;
  const containers = containersResponse.data;
  const categories = categoriesResponse.data;
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
  const effectiveLocation = (item: InventoryRow) => (stockByItem.get(item.id) ?? []).map(stock => {
    const container = stock.inventory_containers;
    return `${stock.quantity} ${item.unit ?? 'uds.'} · ${container ? `Caja: ${container.name} > ${locationPath(container.location_id)}` : locationPath(stock.location_id)}`;
  }).join("; ") || "Sin existencias";
  const lowStock = items.filter((item) => item.status === "low").length;
  const expiring = items.filter((item) => item.expiration_date).length;
  const preferences = preferencesResponse.data;
  const templateDefinitions: InventoryTemplateDefinition[] = (templates ?? []).map((template) => ({
    id: template.id,
    code: template.code,
    name: template.name,
    category: template.category_code,
    categoryName: template.inventory_categories?.name ?? template.category_code,
    description: template.description ?? "",
    fields: (template.inventory_template_fields ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((field) => field.inventory_fields)
      .map((field) => ({
        key: field.inventory_fields?.field_key ?? "",
        label: field.inventory_fields?.label ?? "",
        type: field.inventory_fields?.field_type ?? "text",
        required: field.is_required,
        options: field.inventory_fields?.options ?? []
      }))
  }));

  return (
    <div className="ec-page ec-inventory-page">
      <section className="ec-card ec-hero-card">
        <div className="ec-card-body ec-stack">
          <div className="ec-row ec-row-between ec-row-wrap">
            <div className="ec-col">
              <div className="ec-muted-2">Inventario</div>
              <h1 className="ec-h1">Herramientas, materiales y consumibles</h1>
            </div>
            <span className="ec-badge ec-badge-neutral">
              {canManage ? "Edición habilitada" : "Solo lectura"}
            </span>
          </div>
          <p className="ec-muted">
            Listado operativo del almacén con visibilidad sobre stock, ubicación y
            eventos que requieren atención.
          </p>
          <div className="ec-stat-grid">
            <article className="ec-stat">
              <strong>{totalItems}</strong>
              artículos que coinciden con los filtros
            </article>
            <article className="ec-stat">
              <strong>{lowStock}</strong>
              en stock bajo en esta página
            </article>
            <article className="ec-stat">
              <strong>{expiring}</strong>
              con fecha de caducidad en esta página
            </article>
          </div>
          <div className="ec-inline-notes">
            <span className="ec-badge ec-badge-neutral">
              {!preferences ? "Avisos sin configurar" : preferences.email_notifications_enabled
                ? "Avisos email activos"
                : "Avisos email pausados"}
            </span>
            <span className="ec-help">
              {preferences ? `Antelación actual: ${preferences.expiry_warning_days} días` : "Configura las preferencias para activar los avisos."}
            </span>
          </div>
        </div>
      </section>

      <section className="ec-card">
        <div className="ec-card-header">
          <h2 className="ec-h2">Listado</h2>
          {canManage ? (
            <div className="ec-actions">
              {canConfigureAlerts ? (
                <NotificationPreferencesModal
                  initialValues={{
                    expiryWarningDays: preferences?.expiry_warning_days ?? 14,
                    emailEnabled: preferences?.email_notifications_enabled ?? true,
                    notificationEmail: preferences?.notification_email ?? user.email ?? ""
                  }}
                />
              ) : null}
              <Link className="ec-btn" href="/dashboard/receiving">Recibir material / código de barras</Link>
              <CreateItemModal
                canChooseHeadquarters={canChooseHeadquarters}
                containers={(containers ?? []).map((container) => ({
                  id: container.id,
                  headquarters_id: container.headquarters_id,
                  name: container.code ? `${container.name} · ${container.code}` : container.name
                }))}
                headquarters={(headquarters ?? []).filter((headquarter) => headquarter.is_active)}
                locations={(locations ?? []).map((location) => ({
                  id: location.id,
                  headquarters_id: location.headquarters_id,
                  name: locationPath(location.id)
                }))}
                templates={templateDefinitions}
                userHeadquartersId={profile?.headquarters_id ?? null}
              />
            </div>
          ) : null}
        </div>
        <div className="ec-card-body ec-stack">
          <form action="/dashboard/inventory" method="get" className="ec-inventory-filters">
            <label className="ec-label">Buscar por nombre
              <input className="ec-input" name="q" type="search" defaultValue={q} maxLength={120} placeholder="Nombre del artículo" />
            </label>
            <label className="ec-label">Categoría
              <select className="ec-select" name="category" defaultValue={category}>
                <option value="">Todas</option>
                {category && !categories.some((entry) => entry.code === category) ? <option value={category}>{category} (no disponible)</option> : null}
                {categories.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
              </select>
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
          </form>
          <p className="ec-help" role="status">
            {totalItems ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalItems)} de ${totalItems} artículos` : "0 artículos con estos filtros"}.
            {" "}Los indicadores de stock bajo y caducidad corresponden solo a los {items.length} artículos de esta página, no al total.
          </p>
          <div className="ec-table-wrap ec-inventory-table-wrap">
            <table className="ec-table ec-inventory-table" role="table" aria-label="Inventario filtrado">
                <thead>
                  <tr>
                    <th scope="col">Artículo</th>
                    <th scope="col">Sede</th>
                    <th scope="col">Ubicación efectiva</th>
                    <th scope="col">Stock</th>
                    <th scope="col">Alerta</th>
                    <th scope="col">Estado operativo</th>
                    <th scope="col">Fechas</th>
                  </tr>
                </thead>
                <tbody>
                  {items?.length ? (
                    items.map((item) => (
                      <tr key={item.id}>
                        <td data-label="Artículo">
                          <strong>
                            <Link className="ec-link-strong" href={`/dashboard/inventory/${item.id}`}>
                              {item.name}
                            </Link>
                          </strong>
                          <div className="ec-muted">
                            {item.category}
                            {item.subtype ? ` · ${item.subtype}` : ""}
                          </div>
                        </td>
                        <td data-label="Sede">{item.headquarters?.name ?? "Sede no accesible"}</td>
                        <td data-label="Ubicación efectiva">{effectiveLocation(item)}</td>
                        <td data-label="Stock">
                          {item.current_stock} {item.unit ?? "uds."}
                          {item.minimum_stock !== null ? (
                            <div className="ec-muted">mínimo {item.minimum_stock}</div>
                          ) : null}
                        </td>
                        <td data-label="Alerta">
                          <span className={`ec-badge ${statusBadge(item.status)}`}>
                            {statusLabels[item.status] ?? item.status}
                          </span>
                        </td>
                        <td data-label="Estado operativo">
                          <span className={`ec-badge ${item.operational_status === "available" ? "ec-badge-ok" : item.operational_status === "repair" || item.operational_status === "inspection" ? "ec-badge-warn" : "ec-badge-neutral"}`}>
                            {item.operational_status ? operationalLabels[item.operational_status] ?? item.operational_status : "Sin informar"}
                          </span>
                        </td>
                        <td data-label="Fechas">
                          <div className="ec-col">
                            <span className="ec-muted">
                              Caducidad: {item.expiration_date ?? "—"}
                            </span>
                            <span className="ec-muted">
                              Mantenimiento: {item.maintenance_due_at ?? "—"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="ec-muted" colSpan={7}>
                        No hay artículos que coincidan con los filtros en las sedes accesibles.
                      </td>
                    </tr>
                  )}
                </tbody>
            </table>
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
