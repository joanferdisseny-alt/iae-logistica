import Link from "next/link";
import {
  CreateContainerForm,
  CreateLocationForm,
  DeleteContainerForm,
  DeleteLocationForm,
  EditContainerModal,
  EditLocationModal,
  LocationModal
} from "@/app/dashboard/locations/forms";
import { QrModal } from "@/app/dashboard/qr-modal";
import { requireAccess } from "@/lib/auth/context";
import { CatalogTable } from "../templates/catalog-table";
import { LocationsSubnav } from "./subnav";

type HeadquartersRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type LocationRow = {
  id: string;
  name: string;
  code: string | null;
  location_type: string;
  description: string | null;
  parent_location_id: string | null;
  headquarters_id: string | null;
  headquarters: {
    name: string;
  } | null;
};

type ContainerRow = {
  id: string;
  name: string;
  code: string | null;
  container_type: string;
  description: string | null;
  location_id: string | null;
  headquarters_id: string | null;
  headquarters: {
    name: string;
  } | null;
  locations: {
    name: string;
  } | null;
};

type ContainerItemRow = {
  id: string;
  container_id: string;
  quantity: number;
  notes: string | null;
  inventory_items: {
    id: string;
    name: string;
    current_stock: number;
    unit: string | null;
  } | null;
};

const locationTypeLabels: Record<string, string> = {
  room: "Sala",
  cabinet: "Armario",
  shelf: "Estantería",
  rack: "Rack",
  vehicle: "Vehículo",
  storage: "Almacén",
  other: "Otro"
};

const containerTypeLabels: Record<string, string> = {
  intervention: "Intervención",
  practice: "Prácticas",
  storage: "Almacenamiento",
  transport: "Transporte"
};

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

function LocationsError({ message, href }: { message: string; href: string }) {
  return (
    <div className="ec-page ec-locations-page">
      <LocationsSubnav />
      <section className="ec-card"><div className="ec-card-body ec-stack">
        <h1 className="ec-h1">Ubicaciones no disponibles</h1>
        <p className="ec-error" role="alert">{message}</p>
        <Link className="ec-btn" href={href}>Volver a cargar</Link>
      </div></section>
    </div>
  );
}

export async function LocationsView({ view }: { view: "containers" | "physical" }) {
  const href = view === "physical" ? "/dashboard/locations/physical" : "/dashboard/locations";
  const { supabase, profile, isAdmin } = await requireAccess();
  if (!profile.is_active || (!isAdmin && !profile.headquarters_id)) {
    return <LocationsError href={href} message="Acceso bloqueado: necesitas un perfil activo con sede asignada. Contacta con un administrador." />;
  }
  const canAdminLocations = isAdmin;
  const canChooseHeadquarters = isAdmin;
  const userHeadquartersId = profile.headquarters_id;
  const headquartersQuery = supabase
    .from("headquarters")
    .select("id, name, is_active")
    .order("name", { ascending: true }).order("id");
  const locationsQuery = supabase
    .from("locations")
    .select("id, name, code, location_type, description, parent_location_id, headquarters_id, headquarters(name)")
    .order("name", { ascending: true }).order("id");
  const containersQuery = supabase
    .from("inventory_containers")
    .select("id, name, code, container_type, description, location_id, headquarters_id, headquarters(name), locations(name)")
    .order("name", { ascending: true }).order("id");

  if (!isAdmin) {
    headquartersQuery.eq("id", userHeadquartersId);
    locationsQuery.eq("headquarters_id", userHeadquartersId);
    containersQuery.eq("headquarters_id", userHeadquartersId);
  }

  const [
    headquartersResponse,
    locationsResponse,
    containersResponse
  ] = await Promise.all([
    readAll((from, to) => headquartersQuery.range(from, to).returns<HeadquartersRow[]>()),
    readAll((from, to) => locationsQuery.range(from, to).returns<LocationRow[]>()),
    view === "containers"
      ? readAll((from, to) => containersQuery.range(from, to).returns<ContainerRow[]>())
      : Promise.resolve({ data: [] as ContainerRow[], error: null })
  ]);

  const failed = ([
    ["sedes", headquartersResponse.error], ["ubicaciones", locationsResponse.error],
    ["cajas", containersResponse.error]
  ] as const).filter(([, error]) => error);
  if (failed.length) {
    console.error("Locations read failed", failed);
    return <LocationsError href={href} message={`No se han podido cargar ${failed.map(([name]) => name).join(", ")}. No se muestra un listado parcial. Vuelve a intentarlo o contacta con un administrador.`} />;
  }
  const headquarters = headquartersResponse.data;
  const locations = locationsResponse.data;
  const containers = containersResponse.data;
  const containerIds = containers.map((container) => container.id);
  const containerItems: ContainerItemRow[] = [];
  // Bound URL size and paginate assignments as well as their parent containers.
  for (let offset = 0; offset < containerIds.length; offset += 100) {
    const response = await readAll((from, to) => supabase.from("inventory_container_items")
      .select("id, container_id, quantity, notes, inventory_items(id, name, current_stock, unit)")
      .in("container_id", containerIds.slice(offset, offset + 100))
      .order("id").range(from, to).returns<ContainerItemRow[]>());
    if (response.error) {
      console.error("Container assignments read failed", response.error);
      return <LocationsError href={href} message="No se ha podido cargar el contenido de las cajas. No se muestra un listado parcial. Vuelve a intentarlo o contacta con un administrador." />;
    }
    containerItems.push(...response.data);
  }
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
  const activeHeadquarters = headquarters.filter((headquarter) => headquarter.is_active);
  const locationOptions = locations.map((location) => ({
    id: location.id,
    headquarters_id: location.headquarters_id,
    name: locationPath(location.id)
  }));
  const itemsByContainer = new Map<string, ContainerItemRow[]>();

  for (const item of containerItems ?? []) {
    itemsByContainer.set(item.container_id, [
      ...(itemsByContainer.get(item.container_id) ?? []),
      item
    ]);
  }

  const formOptions = {
    canChooseHeadquarters, headquarters: activeHeadquarters, locations: locationOptions, userHeadquartersId
  };

  const containersPanel = <section className="ec-card">
    <div className="ec-card-header">
      <div className="ec-row ec-row-wrap"><h1 className="ec-h2">Cajas / kits</h1><span className="ec-badge ec-badge-neutral">{containers.length}</span></div>
      {canAdminLocations && <LocationModal title="Nueva caja o kit" trigger="Nueva caja">
        <CreateContainerForm {...formOptions} />
      </LocationModal>}
    </div>
    <CatalogTable
      columns={[{ label: "Caja / kit", className: "ec-field-name-column" }, { label: "Tipo", className: "ec-field-type-column" }, { label: "Sede" }]}
      caption="Selecciona una caja para ver su contenido, ubicación y acciones."
      emptyMessage="Todavía no hay cajas creadas."
      rows={containers.map(container => {
        const assignedItems = itemsByContainer.get(container.id) ?? [];
        return {
          id: container.id, label: container.name,
          cells: [containerTypeLabels[container.container_type] ?? container.container_type, container.headquarters?.name ?? "Sede no accesible"],
          details: <div className="ec-stack">
            <div className="ec-template-detail-heading">
              <div className="ec-template-description">
                <p><strong>Código:</strong> {container.code || "Sin código"}</p>
                <p><strong>Ubicación:</strong> {locationPath(container.location_id)}</p>
                <p className="ec-muted">{container.description || "Sin descripción."}</p>
              </div>
              <div className="ec-actions ec-template-detail-tools">
                <Link className="ec-btn" href={`/dashboard/locations/containers/${container.id}`}>Ver caja y checklists</Link>
                <QrModal label="QR de caja" path={`/dashboard/locations/containers/${container.id}`} title={container.name} />
                {canAdminLocations && <>
                  <EditContainerModal {...formOptions} container={container} />
                  <DeleteContainerForm id={container.id} />
                </>}
              </div>
            </div>
            <div>
              <h3 className="ec-h3">Contenido</h3>
              <div className="ec-assigned-field-grid">
                {assignedItems.length ? assignedItems.map(entry => <div className="ec-assigned-field" key={entry.id}>
                  <div className="ec-assigned-field-main">
                    {entry.inventory_items ? <Link className="ec-link-strong" href={`/dashboard/inventory/${entry.inventory_items.id}`}>{entry.inventory_items.name}</Link> : <strong>Artículo no accesible</strong>}
                    <span>{entry.quantity} {entry.inventory_items?.unit ?? "uds."}{entry.notes ? ` · ${entry.notes}` : ""}</span>
                  </div>
                </div>) : <p className="ec-muted">Sin artículos asignados.</p>}
              </div>
              <p className="ec-help">El material se reparte entre cajas y ubicaciones desde la ficha de cada artículo.</p>
            </div>
          </div>
        };
      })}
    />
  </section>;

  const locationsPanel = <section className="ec-card">
    <div className="ec-card-header">
      <div className="ec-row ec-row-wrap"><h1 className="ec-h2">Ubicaciones físicas</h1><span className="ec-badge ec-badge-neutral">{locations.length}</span></div>
      {canAdminLocations && <LocationModal title="Nueva ubicación" trigger="Nueva ubicación">
        <CreateLocationForm {...formOptions} />
      </LocationModal>}
    </div>
    <CatalogTable
      columns={[{ label: "Ubicación", className: "ec-field-name-column" }, { label: "Tipo", className: "ec-field-type-column" }, { label: "Sede" }]}
      caption="Selecciona una ubicación para ver su jerarquía, descripción y acciones."
      emptyMessage="Todavía no hay ubicaciones físicas. Crea armarios, estanterías o vehículos."
      rows={locations.map(location => ({
        id: location.id, label: location.name,
        cells: [locationTypeLabels[location.location_type] ?? location.location_type, location.headquarters?.name ?? "Sede no accesible"],
        details: <div className="ec-template-detail-heading">
          <div className="ec-template-description">
            <p><strong>Código:</strong> {location.code || "Sin código"}</p>
            <p><strong>Ruta completa:</strong> {locationPath(location.id)}</p>
            <p className="ec-muted">{location.description || "Sin descripción."}</p>
          </div>
          {canAdminLocations && <div className="ec-actions ec-template-detail-tools">
            <EditLocationModal {...formOptions} location={location} />
            <DeleteLocationForm id={location.id} />
          </div>}
        </div>
      }))}
    />
  </section>;

  return <div className="ec-page ec-locations-page">
    <LocationsSubnav />
    {view === "containers" ? containersPanel : locationsPanel}
  </div>;
}
