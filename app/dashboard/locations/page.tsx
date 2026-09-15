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

export const dynamic = "force-dynamic";

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

function LocationsError({ message }: { message: string }) {
  return (
    <section className="ec-card"><div className="ec-card-body ec-stack">
      <h1 className="ec-h1">Ubicaciones no disponibles</h1>
      <p className="ec-error" role="alert">{message}</p>
      <Link className="ec-btn" href="/dashboard/locations">Volver a cargar</Link>
    </div></section>
  );
}

export default async function LocationsPage() {
  const { supabase, profile, isAdmin } = await requireAccess();
  if (!profile.is_active || (!isAdmin && !profile.headquarters_id)) {
    return <LocationsError message="Acceso bloqueado: necesitas un perfil activo con sede asignada. Contacta con un administrador." />;
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
    readAll((from, to) => containersQuery.range(from, to).returns<ContainerRow[]>())
  ]);

  const failed = ([
    ["sedes", headquartersResponse.error], ["ubicaciones", locationsResponse.error],
    ["cajas", containersResponse.error]
  ] as const).filter(([, error]) => error);
  if (failed.length) {
    console.error("Locations read failed", failed);
    return <LocationsError message={`No se han podido cargar ${failed.map(([name]) => name).join(", ")}. No se muestra un listado parcial. Vuelve a intentarlo o contacta con un administrador.`} />;
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
      return <LocationsError message="No se ha podido cargar el contenido de las cajas. No se muestra un listado parcial. Vuelve a intentarlo o contacta con un administrador." />;
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

  return (
    <div className="ec-page ec-locations-page">
      <section className="ec-card ec-hero-card">
        <div className="ec-card-body ec-stack">
          <div className="ec-row ec-row-between ec-row-wrap">
            <div className="ec-col">
              <div className="ec-muted-2">Logística física</div>
              <h1 className="ec-h1">Ubicaciones y cajas</h1>
            </div>
            {canAdminLocations ? (
              <div className="ec-actions">
                <LocationModal title="Nueva ubicación" trigger="Nueva ubicación">
                  <CreateLocationForm
                    canChooseHeadquarters={canChooseHeadquarters}
                    headquarters={activeHeadquarters}
                    locations={locationOptions}
                    userHeadquartersId={profile?.headquarters_id ?? null}
                  />
                </LocationModal>
                <LocationModal title="Nueva caja o kit" trigger="Nueva caja">
                  <CreateContainerForm
                    canChooseHeadquarters={canChooseHeadquarters}
                    headquarters={activeHeadquarters}
                    locations={locationOptions}
                    userHeadquartersId={profile?.headquarters_id ?? null}
                  />
                </LocationModal>
              </div>
            ) : null}
          </div>
          <p className="ec-muted">
            Usa ubicaciones para sitios físicos fijos y cajas para kits móviles de intervención,
            prácticas, transporte o almacenamiento.
          </p>
          {!canAdminLocations ? (
            <p className="ec-help">
              Estás en modo lectura/edición de inventario. Solo los administradores pueden crear,
              editar o borrar ubicaciones.
            </p>
          ) : null}
        </div>
      </section>

      <section className="ec-grid-admin">
        <article className="ec-card">
          <div className="ec-card-header">
            <h2 className="ec-h2">Cajas y kits</h2>
            <span className="ec-badge ec-badge-neutral">{containers?.length ?? 0} cajas</span>
          </div>
          <div className="ec-card-body ec-list">
            {containers?.length ? (
              containers.map((container) => {
                const assignedItems = itemsByContainer.get(container.id) ?? [];

                return (
                  <article className="ec-list-item ec-list-item-block" key={container.id}>
                    <div className="ec-row ec-row-between ec-row-wrap">
                      <div>
                        <Link className="ec-link-strong" href={`/dashboard/locations/containers/${container.id}`}>
                          {container.name}
                        </Link>
                        <div className="ec-muted">
                          {containerTypeLabels[container.container_type] ?? container.container_type}
                          {container.code ? ` · ${container.code}` : ""}
                        </div>
                      </div>
                      <div className="ec-actions">
                        <span className="ec-badge ec-badge-ok">
                          {locationPath(container.location_id)}
                        </span>
                        <QrModal
                          label="QR de caja"
                          path={`/dashboard/locations/containers/${container.id}`}
                          title={container.name}
                        />
                        {canAdminLocations ? (
                          <>
                            <EditContainerModal
                              canChooseHeadquarters={canChooseHeadquarters}
                              container={container}
                              headquarters={activeHeadquarters}
                              locations={locationOptions}
                              userHeadquartersId={profile?.headquarters_id ?? null}
                            />
                            <DeleteContainerForm id={container.id} />
                          </>
                        ) : null}
                      </div>
                    </div>
                    <p className="ec-help">{container.headquarters?.name ?? "Sede no accesible"}</p>
                    {container.description ? <p className="ec-help">{container.description}</p> : null}

                    <div className="ec-assigned-field-grid">
                      {assignedItems.length ? (
                        assignedItems.map((entry) => (
                          <div className="ec-assigned-field" key={entry.id}>
                            <div className="ec-assigned-field-main">
                              <strong>{entry.inventory_items?.name ?? "Artículo no accesible"}</strong>
                              <span>
                                {entry.quantity} {entry.inventory_items?.unit ?? "uds."}
                                {entry.notes ? ` · ${entry.notes}` : ""}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="ec-muted">Sin artículos asignados.</p>
                      )}
                    </div>

                    <div className="ec-help ec-mt-12">
                      Los artículos se asignan a cajas desde la ficha de cada artículo para evitar
                      que tengan caja y ubicación física a la vez.
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="ec-muted">Todavía no hay cajas creadas.</p>
            )}
          </div>
        </article>

        <aside className="ec-card">
          <div className="ec-card-header">
            <h2 className="ec-h2">Ubicaciones físicas</h2>
            <span className="ec-badge ec-badge-neutral">{locations?.length ?? 0}</span>
          </div>
          <div className="ec-card-body ec-list">
            {locations?.length ? (
              locations.map((location) => (
                <div className="ec-list-item ec-list-item-block" key={location.id}>
                  <div className="ec-row ec-row-between ec-row-wrap">
                    <strong>{locationPath(location.id)}</strong>
                    <div className="ec-actions">
                      <span className="ec-badge ec-badge-neutral">
                        {locationTypeLabels[location.location_type] ?? location.location_type}
                      </span>
                      {canAdminLocations ? (
                        <>
                          <EditLocationModal
                            canChooseHeadquarters={canChooseHeadquarters}
                            headquarters={activeHeadquarters}
                            location={location}
                            locations={locationOptions}
                            userHeadquartersId={profile?.headquarters_id ?? null}
                          />
                          <DeleteLocationForm id={location.id} />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="ec-muted">
                    {location.headquarters?.name ?? "Sin sede"}
                    {location.code ? ` · ${location.code}` : ""}
                  </div>
                  {location.description ? <p className="ec-help">{location.description}</p> : null}
                </div>
              ))
            ) : (
              <p className="ec-muted">Crea ubicaciones como armarios, estanterías o vehículos.</p>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
