import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/context";
import { CreateUserModal } from "@/app/dashboard/create-user-form";
import { CatalogTable } from "@/app/dashboard/templates/catalog-table";
import { EditUserModal, UserContact } from "./user-details";
import { escapeUserSearch, parseUserFilters, userListHref, usersPageSize, type RoleRecord, type AdminProfileRow, type HeadquartersRow } from "./model";

export const dynamic = "force-dynamic";

export default async function UsersManagementPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, isAdmin, user } = await requireAccess();
  if (!isAdmin) redirect("/dashboard");
  const filters = parseUserFilters(await searchParams);

  const { data: roles, error: rolesError } = await supabase.from("app_roles")
    .select("id, code, name").order("name").returns<RoleRecord[]>();
  if (rolesError || !roles) throw new Error("No se pueden cargar los roles de usuario.");
  const headquarters: HeadquartersRow[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("headquarters").select("id, name, is_active")
      .order("name").order("id").range(from, from + 499).returns<HeadquartersRow[]>();
    if (error || !data) throw new Error("No se pueden cargar las sedes.");
    headquarters.push(...data);
    if (data.length < 500) break;
  }

  let query = supabase.from("profiles")
    .select("id, full_name, is_active, headquarters_id, is_logistics_contact, notification_preferences(notification_email, expiry_warning_days, email_notifications_enabled), app_roles(code, name), headquarters(name)", { count: "exact" })
    .order("full_name", { ascending: true, nullsFirst: false }).order("id");
  if (filters.q) query = query.ilike("full_name", `%${escapeUserSearch(filters.q)}%`);
  if (filters.site) query = query.eq("headquarters_id", filters.site);
  if (filters.status) query = query.eq("is_active", filters.status === "active");
  const { data: members, error, count } = await query
    .range((filters.page - 1) * usersPageSize, filters.page * usersPageSize - 1).returns<AdminProfileRow[]>();
  if (error || !members || count === null) throw new Error("No se pueden cargar los usuarios. Vuelve a intentarlo.");
  const lastPage = Math.max(1, Math.ceil(count / usersPageSize));
  if (filters.page > lastPage) redirect(userListHref(filters, lastPage));
  const roleOptions = roles.filter(role => ["admin", "editor", "reader"].includes(role.code));

  return <div className="ec-page">
    <section className="ec-card">
      <div className="ec-card-header ec-row-wrap">
        <div className="ec-row ec-row-wrap"><h1 className="ec-h2">Usuarios y permisos</h1><span className="ec-badge ec-badge-neutral">{count}</span></div>
        <CreateUserModal headquarters={headquarters.filter(site => site.is_active)} roles={roleOptions} />
      </div>
      <div className="ec-card-body">
        <form key={`${filters.q}-${filters.site}-${filters.status}`} method="get" className="ec-user-filters">
          <label className="ec-label"><span>Buscar por nombre</span><input className="ec-input" name="q" type="search" maxLength={120} defaultValue={filters.q} placeholder="Nombre del usuario" /></label>
          <label className="ec-label"><span>Sede asignada</span><select className="ec-select" name="site" defaultValue={filters.site}>
            <option value="">Todas las sedes</option>
            {headquarters.map(site => <option key={site.id} value={site.id}>{site.name}{!site.is_active ? " (inactiva)" : ""}</option>)}
          </select></label>
          <label className="ec-label"><span>Estado</span><select className="ec-select" name="status" defaultValue={filters.status}>
            <option value="">Todos</option><option value="active">Activo</option><option value="inactive">Inactivo</option>
          </select></label>
          <div className="ec-row ec-row-wrap"><button className="ec-btn" type="submit">Buscar</button>
            {(filters.q || filters.site || filters.status) && <Link className="ec-btn" href="/dashboard/users">Limpiar</Link>}
          </div>
        </form>
      </div>
      <CatalogTable key={`${filters.page}-${filters.q}-${filters.site}-${filters.status}`}
        columns={[{ label: "Usuario", className: "ec-user-name-column" }, { label: "Rol", className: "ec-user-role-column" }, { label: "Sede" }, { label: "Estado", className: "ec-user-status-column" }]}
        caption="Selecciona un usuario para consultar su correo, editar sus permisos o configurar avisos."
        emptyMessage={filters.q || filters.site || filters.status ? "No hay usuarios con estos filtros." : "Todavía no hay usuarios registrados."}
        rows={members.map(member => ({
          id: member.id, label: member.full_name?.trim() || "Usuario sin nombre",
          cells: [
            member.app_roles?.name ?? "Sin rol",
            member.app_roles?.code === "admin" ? "Todas las sedes" : member.headquarters?.name ?? "Sin sede",
            <span key="status" className={`ec-user-status ${member.is_active ? "is-active" : "is-inactive"}`}>{member.is_active ? "Activo" : "Inactivo"}</span>
          ],
          details: <div className="ec-template-detail-heading">
            <div className="ec-template-description">
              <p className="ec-help">Responsable de logística: <strong>{member.is_logistics_contact ? "Sí" : "No"}</strong>{member.id === user.id ? " · Tu cuenta" : ""}</p>
              <UserContact member={member} />
            </div>
            <div className="ec-actions ec-template-detail-tools">
              <EditUserModal key={`${member.id}-${member.app_roles?.code}-${member.headquarters_id}-${member.is_active}-${member.is_logistics_contact}`}
                member={member} roles={roleOptions} headquarters={headquarters} isSelf={member.id === user.id} />
            </div>
          </div>
        }))}
      />
      <nav className="ec-user-pagination" aria-label="Páginas de usuarios">
        <span className="ec-help">{count ? (filters.page - 1) * usersPageSize + 1 : 0}–{Math.min(filters.page * usersPageSize, count)} de {count} usuarios · Página {filters.page} de {lastPage}</span>
        <div className="ec-row">
          {filters.page > 1 && <Link className="ec-btn" href={userListHref(filters, filters.page - 1)}>Anterior</Link>}
          {filters.page < lastPage && <Link className="ec-btn" href={userListHref(filters, filters.page + 1)}>Siguiente</Link>}
        </div>
      </nav>
    </section>
  </div>;
}
