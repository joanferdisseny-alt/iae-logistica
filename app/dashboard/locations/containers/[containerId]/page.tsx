import { requireAccess } from "@/lib/auth/context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QrModal } from "@/app/dashboard/qr-modal";
import { CreateChecklistModal } from "@/app/dashboard/checklists/forms";
import { todayInSpain } from "@/app/dashboard/checklists/model";

export const dynamic = "force-dynamic";

type ContainerRow = {
  id: string;
  name: string;
  code: string | null;
  container_type: string;
  description: string | null;
  headquarters: {
    name: string;
  } | null;
  locations: {
    name: string;
  } | null;
};

type ContainerItemRow = {
  id: string;
  inventory_stock_lots: { code: string; expiration_date: string | null };
  quantity: number;
  notes: string | null;
  inventory_items: {
    id: string;
    name: string;
    category: string;
    current_stock: number;
    unit: string | null;
    status: string;
  } | null;
};

const containerTypeLabels: Record<string, string> = {
  intervention: "Intervención",
  practice: "Prácticas",
  storage: "Almacenamiento",
  transport: "Transporte"
};

function badgeClass(status: string) {
  if (status === "ok") return "ec-badge-ok";
  if (status === "low") return "ec-badge-warn";
  return "ec-badge-bad";
}

export default async function ContainerDetailPage({
  params
}: {
  params: Promise<{ containerId: string }>;
}) {
  const { containerId } = await params;
  const { supabase, isAdmin } = await requireAccess();
  const { data: container, error: containerError } = await supabase
      .from("inventory_containers")
      .select("id, name, code, container_type, description, headquarters(name), locations(name)")
      .eq("id", containerId)
      .maybeSingle<ContainerRow>();
  if (containerError) throw new Error("No se ha podido cargar la caja.");
  if (!container) notFound();

  const containerItems: ContainerItemRow[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase
      .from("inventory_stock_positions")
      .select("id, quantity, inventory_stock_lots(code, expiration_date), inventory_items(id, name, category, current_stock, unit, status)")
      .eq("container_id", containerId)
      .gt("quantity", 0)
      .order("id")
      .range(from, from + 499)
      .returns<ContainerItemRow[]>();
    if (error || !data) throw new Error("No se ha podido cargar el contenido de la caja.");
    containerItems.push(...data);
    if (data.length < 500) break;
  }

  return (
    <div className="ec-page">
      <section className="ec-card ec-hero-card">
        <div className="ec-card-body ec-stack">
          <div className="ec-row ec-row-between ec-row-wrap">
            <div className="ec-col">
              <div className="ec-muted-2">Contenido de caja</div>
              <h1 className="ec-h1">{container.name}</h1>
            </div>
            <div className="ec-actions">
              <CreateChecklistModal boxes={[{ id: container.id, name: container.name, headquarters: container.headquarters }]}
                defaultContainerId={container.id} today={todayInSpain()} />
              <Link className="ec-btn" href={`/dashboard/checklists?container=${container.id}`}>Historial de checklists</Link>
              <span className="ec-badge ec-badge-ok">
                {containerTypeLabels[container.container_type] ?? container.container_type}
              </span>
              <QrModal
                label="QR de caja"
                path={`/dashboard/locations/containers/${container.id}`}
                title={container.name}
              />
              <Link className="ec-btn" href="/dashboard/locations">
                Volver
              </Link>
            </div>
          </div>

          <div className="ec-inline-notes">
            <span className="ec-help">Sede: {container.headquarters?.name ?? "Sin sede"}</span>
            <span className="ec-help">Ubicación: {container.locations?.name ?? "Sin ubicación"}</span>
            {container.code ? <span className="ec-help">Código: {container.code}</span> : null}
          </div>

          {container.description ? <p className="ec-muted">{container.description}</p> : null}
        </div>
      </section>

      <section>
        <article className="ec-card">
          <div className="ec-card-header">
            <h2 className="ec-h2">Artículos y lotes dentro</h2>
            <span className="ec-badge ec-badge-neutral">{containerItems?.length ?? 0}</span>
            {isAdmin ? <Link className="ec-btn" href="/dashboard/inventory">Gestionar desde inventario</Link> : null}
          </div>
          <div className="ec-card-body ec-list">
            {containerItems?.length ? (
              containerItems.map((entry) => (
                <div className="ec-list-item" key={entry.id}>
                  <div>
                    {entry.inventory_items ? (
                      <Link className="ec-link-strong" href={`/dashboard/inventory/${entry.inventory_items.id}`}>
                        {entry.inventory_items.name}
                      </Link>
                    ) : (
                      <strong>Artículo</strong>
                    )}
                    <div className="ec-muted">
                      {entry.quantity} {entry.inventory_items?.unit ?? "uds."}
                      {` · Lote: ${entry.inventory_stock_lots.code} · Caducidad: ${entry.inventory_stock_lots.expiration_date ?? "Sin fecha"}`}
                    </div>
                  </div>
                  <span className={`ec-badge ${badgeClass(entry.inventory_items?.status ?? "low")}`}>
                    {entry.inventory_items?.status ?? "sin dato"}
                  </span>
                </div>
              ))
            ) : (
              <p className="ec-muted">Esta caja todavía no tiene artículos asignados.</p>
            )}
          </div>
        </article>

      </section>
    </div>
  );
}
