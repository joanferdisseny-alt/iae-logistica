import Link from "next/link";
import { DocumentForm } from "@/app/dashboard/inventory/document-form";
import { notFound } from "next/navigation";
import { AddRelationForm } from "@/app/dashboard/inventory/add-relation-form";
import { StockSection } from "@/app/dashboard/inventory/stock-section";
import { QrModal } from "@/app/dashboard/qr-modal";
import { requireAccess } from "@/lib/auth/context";
import { OperationsForm } from "@/app/dashboard/inventory/operations-form";
import { productProviders, productSourceSchema, productSourceUrl } from "@/lib/inventory/product-source";
import { currentInventoryStatus, inventoryToday } from "@/lib/inventory/expiry-status";
import { SizeSummary } from "../size-summary";
import type { SizeProduct } from "@/lib/inventory/size-catalog";
import { ProductNavigation } from "../product-navigation";
import { productSectionHref, resolveProductSection } from "@/lib/inventory/product-sections";

export const dynamic = "force-dynamic";

function ProductSourceHistory({ details }: { details: Record<string, unknown> | null }) {
  const parsed = productSourceSchema.safeParse(details?.source);
  if (!parsed.success) return null;
  const source = parsed.data;
  return <p className="ec-help">Datos externos revisados por el usuario. Código {source.code}. <a className="ec-link-strong" href={productSourceUrl(source.provider, source.code)} target="_blank" rel="noopener noreferrer">Fuente: {productProviders[source.provider]}</a></p>;
}

type ItemDetail = {
  id: string;
  headquarters_id: string | null;
  name: string;
  category: string;
  subtype: string | null;
  description: string | null;
  sku: string | null;
  serial_number: string | null;
  current_stock: number;
  minimum_stock: number | null;
  unit: string | null;
  status: string;
  operational_status: string;
  expiration_date: string | null;
  maintenance_due_at: string | null;
  technical_specs: Record<string, string>;
  location_id: string | null;
  locations: {
    name: string;
  } | null;
  inventory_templates: {
    name: string;
    inventory_template_fields?: Array<{ inventory_fields: { field_key: string; label: string } | null }>;
  } | null;
};

type RelationRow = {
  id: string;
  relation_type: string;
  quantity_required: number | null;
  notes: string | null;
  target_item_id: string;
};

type RelatedItem = {
  id: string;
  name: string;
  current_stock: number;
  unit: string | null;
  status: string;
};

type MovementRow = {
  id: string;
  movement_type: string;
  quantity: number | string;
  balance_after: number | string | null;
  request_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

type HistoryRow = {
  id: string;
  actor_id: string | null;
  event_type: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

type AttachmentRow = {
  id: string;
  title: string;
  url: string | null;
  storage_path: string | null;
};

const operationalLabels: Record<string, string> = {
  available: "Disponible", in_use: "En uso", repair: "En reparación",
  inspection: "En inspección", retired: "Retirado"
};
const movementLabels: Record<string, string> = {
  in: "Entrada", out: "Salida", adjustment: "Ajuste por recuento"
};

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(date)
    : "Fecha no disponible";
}

function safeAttachmentUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function badgeClass(status: string) {
  if (status === "ok") return "ec-badge-ok";
  if (status === "low") return "ec-badge-warn";
  return "ec-badge-bad";
}

async function readRelationOptions(query: (from: number, to: number) => PromiseLike<{
  data: RelatedItem[] | null; error: { message: string } | null;
}>) {
  const items: RelatedItem[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await query(from, from + 499);
    if (error || !data) return { data: [], error: error ?? { message: "Respuesta sin datos" } };
    items.push(...data);
    if (data.length < 500) return { data: items, error: null };
  }
}

export default async function InventoryItemPage({
  params,
  searchParams
}: {
  params: Promise<{ itemId: string }>;
  searchParams?: Promise<{ historyPage?: string; section?: string }>;
}) {
  const { itemId } = await params;
  const { supabase, profile, isAdmin } = await requireAccess();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) notFound();
  let itemQuery = supabase.from("inventory_items").select(
    "id, headquarters_id, name, category, subtype, description, sku, serial_number, current_stock, minimum_stock, unit, status, operational_status, expiration_date, maintenance_due_at, technical_specs, location_id, locations(name), inventory_templates(name, inventory_template_fields(inventory_fields(field_key, label)))"
  ).eq("id", itemId);
  if (!isAdmin) {
    if (!profile.headquarters_id) notFound();
    itemQuery = itemQuery.eq("headquarters_id", profile.headquarters_id);
  }
  const { data: item, error: itemError } = await itemQuery.maybeSingle<ItemDetail>();
  if (itemError) throw new Error("No se pudo cargar la ficha. Comprueba el contrato SQL y los permisos.");
  if (!item) notFound();
  const productResult = await supabase.from("inventory_catalog_items")
    .select("id, name, is_size_group, current_stock, unit, size_count, variants")
    .contains("item_ids", [item.id]).maybeSingle<SizeProduct>();
  if (productResult.error || !productResult.data) return <section className="ec-card"><div className="ec-card-body ec-stack">
    <h1 className="ec-h1">No se pudo cargar el catálogo</h1>
    <p className="ec-error" role="alert">{isAdmin ? "Comprueba supabase/upgrade-size-catalog.sql. No se muestra un desglose parcial ni es necesario volver a importar el stock." : "No se pudo cargar la ficha completa. Contacta con un administrador."}</p>
    <Link className="ec-btn" href="/dashboard/inventory">Volver</Link>
  </div></section>;
  const product = productResult.data;
  const isSizeGroup = product.is_size_group;
  const queryParams = await searchParams;
  const section = resolveProductSection(queryParams?.section, isSizeGroup, queryParams?.historyPage);
  const fieldLabels = new Map((item.inventory_templates?.inventory_template_fields ?? []).flatMap(assignment =>
    assignment.inventory_fields ? [[assignment.inventory_fields.field_key, assignment.inventory_fields.label]] : []));
  const status = currentInventoryStatus(item, inventoryToday());
  const headquartersFilter = item.headquarters_id
    ? `headquarters_id.eq.${item.headquarters_id}` : "headquarters_id.is.null";

  const requestedPage = Number(queryParams?.historyPage ?? 1);
  const historyPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1;
  const offset = (historyPage - 1) * 50;
  const empty = <T,>() => ({ data: [] as T[], error: null });
  const [relationsResult, otherItemsResult, movementsResult, historyResult, attachmentsResult] = await Promise.all([
    section === "resources" ? supabase
    .from("inventory_item_relations")
    .select("id, relation_type, quantity_required, notes, target_item_id")
    .eq("source_item_id", itemId)
    .returns<RelationRow[]>() : empty<RelationRow>(),
    section === "resources" && isAdmin ? readRelationOptions((from, to) => supabase.from("inventory_items")
      .select("id, name, current_stock, unit, status").neq("id", itemId).or(headquartersFilter)
      .order("name").order("id").range(from, to).returns<RelatedItem[]>()) : empty<RelatedItem>(),
    section === "history" ? supabase.from("inventory_movements")
      .select("id, movement_type, quantity, balance_after, request_id, notes, created_by, created_at")
      .eq("item_id", itemId).order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 50).returns<MovementRow[]>() : empty<MovementRow>(),
    section === "history" ? supabase.from("inventory_item_history")
      .select("id, actor_id, event_type, details, created_at")
      .eq("item_id", itemId).order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 50).returns<HistoryRow[]>() : empty<HistoryRow>(),
    section === "resources" ? supabase.from("inventory_attachments")
      .select("id, title, url, storage_path").eq("item_id", itemId)
      .order("created_at", { ascending: false }).returns<AttachmentRow[]>() : empty<AttachmentRow>()
  ]);
  const relations = relationsResult.data;
  const relatedIds = relations?.map((relation) => relation.target_item_id) ?? [];
  const relatedResult = relatedIds.length
    ? await supabase.from("inventory_items")
        .select("id, name, current_stock, unit, status").in("id", relatedIds).or(headquartersFilter)
        .returns<RelatedItem[]>()
    : { data: [] as RelatedItem[], error: null };

  const otherItems = otherItemsResult.data;
  const optionsError = otherItemsResult.error;
  const relatedItems = relatedResult.data;
  const canManage = isAdmin;
  const relatedById = new Map((relatedItems ?? []).map((relatedItem) => [relatedItem.id, relatedItem]));

  return (
    <div className="ec-page ec-product-page">
      <section className="ec-card ec-hero-card" id="talla">
        <div className="ec-card-body ec-stack">
          <div className="ec-row ec-row-between ec-row-wrap">
            <div className="ec-col">
              <Link className="ec-help" href={`/dashboard/catalog?category=${encodeURIComponent(item.category)}${item.headquarters_id ? `&headquarters=${item.headquarters_id}` : ""}`} prefetch={false}>Volver a la categoría</Link>
              <h1 className="ec-h1">{isSizeGroup ? product.name : item.name}</h1>
              <span className="ec-help">{item.inventory_templates?.name ?? item.category}{isSizeGroup ? ` · ${product.current_stock} ${product.unit ?? "uds."} entre todas las tallas` : ""}</span>
            </div>
            <div className="ec-actions">
              <span className={`ec-badge ${badgeClass(status)}`}>{({ ok: "Correcto", low: "Stock bajo", expired: "Caducado", maintenance: "Mantenimiento" } as Record<string, string>)[status] ?? status}</span>
              <span className="ec-badge ec-badge-neutral">{operationalLabels[item.operational_status] ?? item.operational_status}</span>
              <QrModal
                label={isSizeGroup ? "QR de talla" : "QR de ficha"}
                buttonLabel={isSizeGroup ? "QR talla" : "QR ficha"}
                path={`/dashboard/inventory/${item.id}`}
                title={item.name}
              />
              {isSizeGroup && <QrModal label="QR de prenda" buttonLabel="QR prenda" path={`/dashboard/inventory/${product.id}`} title={product.name} />}
              <Link className="ec-btn" href="/dashboard/inventory" prefetch={false}>Listado</Link>
            </div>
          </div>

          {isSizeGroup && <div className="ec-product-variant">
            <details><summary>Talla {item.technical_specs.uniformidad_talla} · Cambiar talla</summary>
              <nav className="ec-size-links" aria-label="Seleccionar talla">{product.variants.map(variant => <Link key={variant.id} href={productSectionHref(variant.id, section)} prefetch={false} aria-current={variant.id === item.id ? "page" : undefined}>{variant.size} · {variant.quantity} {item.unit ?? "uds."}</Link>)}</nav>
            </details>
            <span className="ec-help">Las operaciones, documentos y el historial corresponden a la talla seleccionada.</span>
          </div>}
          <div className="ec-inline-notes"><Link className="ec-link-strong" prefetch={false} href={productSectionHref(item.id, "stock")}>Stock{isSizeGroup ? " de esta talla" : ""}: {item.current_stock} {item.unit ?? "uds."} · Ver ubicaciones</Link></div>
        </div>
      </section>
      <ProductNavigation itemId={item.id} section={section} hasSizes={isSizeGroup} />
      {section === "sizes" && <SizeSummary product={product} selectedId={item.id} embedded />}
      {section === "stock" && <StockSection itemId={item.id} itemName={item.name} headquartersId={item.headquarters_id} unit={item.unit} />}
      {section === "overview" && <section className="ec-card">
        <div className="ec-card-header ec-row-wrap"><h2 className="ec-h2">Información del artículo</h2>{canManage && <OperationsForm item={item} distributedStock />}</div>
        <div className="ec-card-body ec-stack">
          {item.description && <p>{item.description}</p>}
          {!canManage && <p className="ec-help">Acceso de consulta. Las operaciones están reservadas a administración.</p>}
          <dl className="ec-product-facts">
            <div><dt>Referencia / SKU</dt><dd>{item.sku ?? "Sin referencia"}</dd></div>
            <div><dt>Número de serie</dt><dd>{item.serial_number ?? "Sin serie"}</dd></div>
            <div><dt>Stock mínimo</dt><dd>{item.minimum_stock ?? "Sin mínimo"}</dd></div>
            <div><dt>Próximo mantenimiento</dt><dd>{item.maintenance_due_at ?? "Sin programar"}</dd></div>
            <div><dt>Próxima caducidad</dt><dd>{item.expiration_date ?? "Sin fecha"}</dd></div>
          </dl>
          <h3 className="ec-h3">Características</h3>
          {Object.keys(item.technical_specs ?? {}).length ? <dl className="ec-product-facts">{Object.entries(item.technical_specs ?? {}).map(([key, value]) => <div key={key}><dt>{fieldLabels.get(key) ?? key}</dt><dd>{String(value)}</dd></div>)}</dl> : <p className="ec-help">Esta ficha no tiene campos técnicos guardados.</p>}
          <p className="ec-help">Cada lote conserva su propia caducidad. Consulta cantidades, cajas y destinos en Existencias.</p>
        </div>
      </section>}
      {section === "resources" && <><section className={canManage ? "ec-grid-admin" : "ec-stack"}>
        <article className="ec-card">
          <div className="ec-card-header">
            <h2 className="ec-h2">Relaciones y compatibilidades</h2>
          </div>
          <div className="ec-card-body ec-list">
            {relationsResult.error || relatedResult.error ? <p className="ec-error" role="alert">No se pudieron cargar las relaciones.</p> : relations?.length ? (
              relations.map((relation) => {
                const related = relatedById.get(relation.target_item_id);
                if (!related) return null;

                return (
                  <div className="ec-list-item" key={relation.id}>
                    <div>
                      <Link className="ec-link-strong" href={`/dashboard/inventory/${related.id}`} prefetch={false}>{related.name}</Link>
                      <div className="ec-muted">
                        {relation.relation_type} · necesita {relation.quantity_required ?? 1}
                      </div>
                      {relation.notes ? <div className="ec-help">{relation.notes}</div> : null}
                    </div>
                    <div className="ec-col ec-align-end">
                      <span className={`ec-badge ${badgeClass(related?.status ?? "low")}`}>
                        {related?.status ?? "sin dato"}
                      </span>
                      <span className="ec-help">
                        Quedan {related?.current_stock ?? 0} {related?.unit ?? "uds."}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="ec-muted">No hay artículos asociados todavía.</p>
            )}
          </div>
        </article>

        <div className="ec-stack ec-side-rail">
          {canManage && optionsError && <p className="ec-error" role="alert">No se pudo cargar el catálogo completo de artículos para asociar. Vuelve a cargar la ficha.</p>}
          {canManage && !optionsError ? (
            <article className="ec-card ec-card-toned">
              <div className="ec-card-header">
                <h2 className="ec-h2">Asociar artículo</h2>
              </div>
              <div className="ec-card-body ec-stack">
                <p className="ec-muted">
                  Relaciona esta ficha con consumibles, piezas o materiales compatibles.
                </p>
                <AddRelationForm
                  options={(otherItems ?? []).map((otherItem) => ({
                    id: otherItem.id,
                    name: otherItem.name,
                    currentStock: otherItem.current_stock,
                    unit: otherItem.unit
                  }))}
                  sourceItemId={item.id}
                />
              </div>
            </article>
          ) : null}
        </div>
      </section>

      <section className="ec-card">
        <div className="ec-card-header"><h2 className="ec-h2">Manuales y documentos</h2>{isAdmin ? <DocumentForm itemId={itemId} /> : null}</div>
        <div className="ec-card-body ec-list">
          {attachmentsResult.error ? <p className="ec-error" role="alert">No se pudieron cargar los enlaces. Comprueba la tabla inventory_attachments y sus permisos.</p>
            : attachmentsResult.data?.length ? attachmentsResult.data.map((attachment) => {
              const href = attachment.storage_path ? `/api/documents/${attachment.id}` : safeAttachmentUrl(attachment.url ?? "");
              return <div className="ec-list-item" key={attachment.id}>
                {href ? <a className="ec-btn" href={href} rel="noopener noreferrer" target="_blank">{attachment.title} (abrir enlace)</a>
                  : <span className="ec-muted">{attachment.title}: enlace no válido</span>}
              </div>;
            }) : <p className="ec-muted">No hay manuales enlazados.</p>}
        </div>
      </section>
      </>}
      {section === "history" && <><section className="ec-card" id="historial">
        <div className="ec-card-header"><h2 className="ec-h2">Historial de movimientos</h2></div>
        <div className="ec-card-body ec-stack">
          <p className="ec-help">El ajuste representa el stock final contado. Saldo: existencias después del movimiento. Las fechas se muestran en horario de Madrid.</p>
          {movementsResult.error ? <p className="ec-error" role="alert">No se pudieron cargar los movimientos. Comprueba balance_after, request_id y sus permisos.</p>
            : movementsResult.data?.length ? <div className="ec-table-wrap"><table className="ec-table">
              <thead><tr><th scope="col">Fecha</th><th scope="col">Operación</th><th scope="col">Cantidad / recuento</th><th scope="col">Saldo</th><th scope="col">Motivo y trazabilidad</th></tr></thead>
              <tbody>{movementsResult.data.slice(0, 50).map((movement) => <tr key={movement.id}>
                <td><time dateTime={movement.created_at}>{timestamp(movement.created_at)}</time></td>
                <td>{movementLabels[movement.movement_type] ?? movement.movement_type}</td>
                <td>{movement.quantity} {item.unit ?? "uds."}</td>
                <td>{movement.balance_after ?? "Sin registro"}</td>
                <td><div>{movement.notes ?? "Sin motivo registrado"}</div><details><summary className="ec-help">Identificadores</summary><div className="ec-help">Actor: {movement.created_by ?? "No registrado"}</div><div className="ec-help">Solicitud: {movement.request_id ?? "Movimiento anterior al control de duplicados"}</div></details></td>
              </tr>)}</tbody>
            </table></div> : <p className="ec-muted">No hay movimientos en esta página.</p>}
        </div>
      </section>

      <section className="ec-card">
        <div className="ec-card-header"><h2 className="ec-h2">Historial de ficha y mantenimiento</h2></div>
        <div className="ec-card-body ec-list">
          {historyResult.error ? <p className="ec-error" role="alert">No se pudo cargar el historial de ficha. Comprueba inventory_item_history y sus permisos.</p>
            : historyResult.data?.length ? historyResult.data.slice(0, 50).map((entry) => <div className="ec-list-item ec-list-item-block" key={entry.id}>
              <strong>{entry.event_type === "online_product_review" ? "Borrador online revisado" : entry.event_type}</strong>
              {entry.event_type === "online_product_review" && <ProductSourceHistory details={entry.details}/>}
              <div className="ec-help"><time dateTime={entry.created_at}>{timestamp(entry.created_at)}</time> · Actor: {entry.actor_id ?? "No registrado"}</div>
              <details><summary>Ver cambios</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(entry.details ?? {}, null, 2)}</pre></details>
            </div>) : <p className="ec-muted">No hay cambios de ficha en esta página.</p>}
        </div>
      </section>
      <nav aria-label="Páginas de ambos historiales" className="ec-actions ec-row-wrap">
        {historyPage > 1 ? <Link className="ec-btn" prefetch={false} href={productSectionHref(item.id, "history", historyPage - 1)}>Anterior</Link> : null}
        <span className="ec-help">Página {historyPage} · hasta 50 registros por historial</span>
        {(movementsResult.data?.length ?? 0) > 50 || (historyResult.data?.length ?? 0) > 50 ? <Link className="ec-btn" prefetch={false} href={productSectionHref(item.id, "history", historyPage + 1)}>Siguiente</Link> : null}
      </nav>
      </>}
    </div>
  );
}
