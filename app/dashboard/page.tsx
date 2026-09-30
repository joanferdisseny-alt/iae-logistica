import Link from "next/link";
import { requireAccess } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

const quickActions = [
  {
    href: "/dashboard/inventory",
    title: "Inventario",
    description: "Alta, consulta y control de herramientas, materiales y consumibles."
  },
  {
    href: "/dashboard/locations",
    title: "Ubicaciones",
    description: "Gestiona armarios, estanterías, vehículos y cajas de intervención o prácticas."
  },
  {
    href: "/dashboard/templates",
    adminOnly: true,
    title: "Fichas",
    description: "Configura categorías, campos y fichas reutilizables para el inventario."
  },
  {
    href: "/dashboard/users",
    adminOnly: true,
    title: "Usuarios",
    description: "Gestiona accesos, roles y sede asignada a cada persona."
  },
  {
    href: "/dashboard/headquarters",
    adminOnly: true,
    title: "Sedes",
    description: "Crea, edita o desactiva sedes operativas."
  },
  { href: "/dashboard/checklists", title: "Checklists", description: "Comprueba el retorno de material tras prácticas e intervenciones, también mediante QR." },
  { href: "/dashboard/requests", title: "Solicitudes", description: "Pide material y consulta el seguimiento de las solicitudes a logística." },
  { href: "/dashboard/receiving", title: "Recepción", description: "Consulta códigos de barras y registra entradas o solicita la catalogación de material." }
];

export default async function DashboardPage() {
  const { isAdmin } = await requireAccess();
  return (
    <div className="ec-page">
      <section className="ec-card ec-hero-card">
        <div className="ec-card-body ec-stack">
          <div className="ec-muted-2">Panel operativo</div>
          <h1 className="ec-h1">Logística IAE</h1>
          <p className="ec-muted">
            Consulta el material de tu sede, localiza los recursos y comprueba
            su retorno después de cada actividad.
          </p>
        </div>
      </section>

      <section className="ec-grid-2">
        {quickActions.filter(action => !action.adminOnly || isAdmin).map((action) => (
          <Link className="ec-card ec-link-card" href={action.href} key={action.href}>
            <div className="ec-card-body ec-stack">
              <div className="ec-row ec-row-between ec-row-wrap">
                <h2 className="ec-h2">{action.title}</h2>
                <span className="ec-badge ec-badge-neutral">Abrir</span>
              </div>
              <p className="ec-muted">{action.description}</p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
