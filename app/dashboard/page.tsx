import Link from "next/link";
import { requireAccess } from "@/lib/auth/context";
import { Icon, type IconName } from "./icons";

export const dynamic = "force-dynamic";

const tasks: { href: string; title: string; description: string; icon: IconName }[] = [
  { href: "/dashboard/receiving", title: "Recibir material", description: "Escanear y registrar entradas.", icon: "scan" },
  { href: "/dashboard/locations", title: "Cajas y kits", description: "Contenido, ubicación y QR.", icon: "box" },
  { href: "/dashboard/checklists", title: "Hacer un checklist", description: "Comprobar el material de vuelta.", icon: "check" },
  { href: "/dashboard/requests", title: "Pedir material", description: "Solicitudes y seguimiento.", icon: "request" }
];

export default async function DashboardPage() {
  const { isAdmin } = await requireAccess();
  return <div className="ec-page ec-home">
    <section className="ec-home-welcome">
      <div className="ec-home-title"><div><div className="ec-eyebrow">IAE / LOGÍSTICA</div><h1>Panel de trabajo</h1><p>Encuentra material y continúa con tu próxima tarea.</p></div><span className="ec-home-mark" aria-hidden="true"><Icon name="box" /></span></div>
      <form action="/dashboard/inventory" method="get" className="ec-home-search">
        <label className="ec-sr-only" htmlFor="home-search">Buscar artículos por nombre</label>
        <input className="ec-input" id="home-search" name="q" type="search" maxLength={120} placeholder="Buscar un artículo en el inventario…" />
        <button className="ec-btn ec-btn-primary" type="submit"><Icon name="search" />Buscar</button>
      </form>
      <div className="ec-actions"><Link href="/dashboard/catalog" prefetch={false}><Icon name="folder" />Explorar catálogo</Link><Link href="/dashboard/inventory" prefetch={false}><Icon name="list" />Todo el inventario</Link><Link href="/dashboard/personal" prefetch={false}><Icon name="personal" />Mi material</Link></div>
    </section>
    <section aria-labelledby="daily-tasks">
      <h2 className="ec-h2" id="daily-tasks">Trabajo diario</h2>
      <div className="ec-home-tasks">{tasks.map(task => <Link className="ec-home-task" href={task.href} key={task.href} prefetch={false}>
        <span className="ec-home-task-icon"><Icon name={task.icon} /></span><div><h3>{task.title}</h3><p>{task.description}</p></div><Icon name="chevron" />
      </Link>)}</div>
    </section>
    <section className="ec-home-review" aria-labelledby="review-title">
      <div><h2 className="ec-h2" id="review-title">Revisar material</h2><p className="ec-help">Accesos a los filtros del inventario de tus sedes.</p></div>
      <div className="ec-actions"><Link href="/dashboard/inventory?status=low" prefetch={false}><Icon name="warning" />Stock bajo</Link><Link href="/dashboard/inventory?status=expired" prefetch={false}><Icon name="warning" />Caducados</Link><Link href="/dashboard/inventory?operational_status=repair" prefetch={false}><Icon name="settings" />En reparación</Link></div>
    </section>
    {isAdmin && <section className="ec-card ec-home-admin">
      <div className="ec-col"><h2 className="ec-h2">Administración</h2><p className="ec-help">Catálogo, accesos y organización.</p></div>
      <div className="ec-actions"><Link className="ec-btn" href="/dashboard/imports" prefetch={false}><Icon name="import" />Importar stock</Link><Link className="ec-btn" href="/dashboard/templates" prefetch={false}><Icon name="template" />Configurar fichas</Link><Link className="ec-btn" href="/dashboard/users" prefetch={false}><Icon name="users" />Usuarios</Link><Link className="ec-btn" href="/dashboard/headquarters" prefetch={false}><Icon name="pin" />Sedes</Link></div>
    </section>}
  </div>;
}
