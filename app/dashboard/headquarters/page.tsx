import { requireAccess } from "@/lib/auth/context";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CreateHeadquartersModal,
  DeleteHeadquartersForm,
  EditHeadquartersModal
} from "@/app/dashboard/headquarters/forms";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type HeadquartersRow = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  is_active: boolean;
};

type ProfileRow = {
  headquarters_id: string | null;
};

type InventoryRow = {
  headquarters_id: string | null;
};

export default async function HeadquartersPage() {
  const { supabase } = await requireAccess();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/dashboard/headquarters");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("app_roles(code)")
    .eq("id", user.id)
    .maybeSingle<{ app_roles: { code: string } | null }>();

  if (profile?.app_roles?.code !== "admin") {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const [
    { data: headquarters, error: headquartersError },
    { data: profiles },
    { data: inventoryItems }
  ] = await Promise.all([
    admin
      .from("headquarters")
      .select("id, name, slug, address, city, province, country, is_active")
      .order("name", { ascending: true })
      .returns<HeadquartersRow[]>(),
    admin
      .from("profiles")
      .select("headquarters_id")
      .returns<ProfileRow[]>(),
    admin
      .from("inventory_items")
      .select("headquarters_id")
      .returns<InventoryRow[]>()
  ]);

  const userCounts = new Map<string, number>();
  for (const member of profiles ?? []) {
    if (member.headquarters_id) {
      userCounts.set(member.headquarters_id, (userCounts.get(member.headquarters_id) ?? 0) + 1);
    }
  }

  const itemCounts = new Map<string, number>();
  for (const item of inventoryItems ?? []) {
    if (item.headquarters_id) {
      itemCounts.set(item.headquarters_id, (itemCounts.get(item.headquarters_id) ?? 0) + 1);
    }
  }

  return (
    <div className="ec-page">
      <section className="ec-card">
        <div className="ec-card-header">
          <div className="ec-col">
            <div className="ec-muted-2">Administración</div>
            <h1 className="ec-h1">Sedes</h1>
          </div>
          <Link className="ec-btn" href="/dashboard">
            Volver al panel
          </Link>
        </div>
        <div className="ec-card-body">
          <p className="ec-muted">
            Gestiona las sedes operativas. Los administradores ven todo; editores y
            lectores trabajan solo con la sede asignada.
          </p>
        </div>
      </section>

      <section className="ec-card">
        <div className="ec-card-header">
          <h2 className="ec-h2">Sedes actuales</h2>
          <CreateHeadquartersModal />
        </div>
        <div className="ec-card-body">
          <div className="ec-compact-list">
            {(headquarters ?? []).map((headquarter) => (
              <article className="ec-template-card is-compact" key={headquarter.id}>
                <div className="ec-template-card-head">
                  <div className="ec-col">
                    <div className="ec-row ec-row-wrap">
                      <h3 className="ec-h3">{headquarter.name}</h3>
                      <span
                        className={`ec-badge ${
                          headquarter.is_active ? "ec-badge-ok" : "ec-badge-bad"
                        }`}
                      >
                        {headquarter.is_active ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <div className="ec-muted">
                      {headquarter.slug}
                      {headquarter.city ? ` · ${headquarter.city}` : ""}
                      {headquarter.province ? ` · ${headquarter.province}` : ""}
                    </div>
                    {headquarter.address ? <div className="ec-help">{headquarter.address}</div> : null}
                  </div>

                  <div className="ec-actions">
                    <span className="ec-badge ec-badge-neutral">
                      {userCounts.get(headquarter.id) ?? 0} usuarios
                    </span>
                    <span className="ec-badge ec-badge-neutral">
                      {itemCounts.get(headquarter.id) ?? 0} artículos
                    </span>
                    <EditHeadquartersModal headquarters={headquarter} />
                    <DeleteHeadquartersForm id={headquarter.id} />
                  </div>
                </div>
              </article>
            ))}

            {headquarters?.length ? null : (
              <p className={headquartersError ? "ec-error" : "ec-muted"}>
                {headquartersError
                  ? `No se han podido cargar las sedes: ${headquartersError.message}`
                  : "Todavía no hay sedes creadas."}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
