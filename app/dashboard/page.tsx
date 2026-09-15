import Link from "next/link";

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
    title: "Fichas",
    description: "Configura categorías, campos y fichas reutilizables para el inventario."
  },
  {
    href: "/dashboard/users",
    title: "Usuarios",
    description: "Gestiona accesos, roles y sede asignada a cada persona."
  },
  {
    href: "/dashboard/headquarters",
    title: "Sedes",
    description: "Crea, edita o desactiva sedes operativas."
  }
];

export default function DashboardPage() {
  return (
    <div className="ec-page">
      <section className="ec-card ec-hero-card">
        <div className="ec-card-body ec-stack">
          <div className="ec-muted-2">Panel operativo</div>
          <h1 className="ec-h1">Logística IAE</h1>
          <p className="ec-muted">
            Acceso rápido a las áreas principales. Las consultas pesadas se cargan
            dentro de cada sección para que el inicio de sesión sea inmediato.
          </p>
        </div>
      </section>

      <section className="ec-grid-2">
        {quickActions.map((action) => (
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
