import Link from "next/link";
import { requireAccess } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

const tasks = [
  { href: "/dashboard/receiving", title: "Recibir material", description: "Escanea el código de barras y registra dónde va cada cantidad.", number: "01" },
  { href: "/dashboard/locations", title: "Preparar una caja", description: "Localiza cajas, kits y su contenido para prácticas o intervención.", number: "02" },
  { href: "/dashboard/checklists", title: "Comprobar el retorno", description: "Revisa el contenido de una caja, a mano o leyendo sus QR.", number: "03" },
  { href: "/dashboard/requests", title: "Pedir material", description: "Envía una solicitud a logística y consulta su seguimiento.", number: "04" }
];

export default async function DashboardPage() {
  const { isAdmin } = await requireAccess();
  return <div className="ec-page ec-home">
    <section className="ec-home-welcome">
      <div className="ec-eyebrow">IAE / CENTRO DE OPERACIONES</div>
      <h1>Todo el material.<br /><span>Un mismo lugar.</span></h1>
      <p>Encuentra, organiza y prepara los recursos de tu sede.</p>
      <form action="/dashboard/inventory" method="get" className="ec-home-search">
        <label className="ec-sr-only" htmlFor="home-search">Buscar artículos por nombre</label>
        <input className="ec-input" id="home-search" name="q" type="search" maxLength={120} placeholder="Buscar un artículo en el inventario…" />
        <button className="ec-btn ec-btn-primary" type="submit">Buscar</button>
      </form>
      <div className="ec-actions"><Link href="/dashboard/catalog">Explorar catálogo por categorías</Link><Link href="/dashboard/inventory">Ver todo el inventario</Link><Link href="/dashboard/personal">Mi material entregado</Link></div>
    </section>
    <section aria-labelledby="daily-tasks">
      <h2 className="ec-h2" id="daily-tasks">¿Qué necesitas hacer?</h2>
      <div className="ec-home-tasks">{tasks.map(task => <Link className="ec-home-task" href={task.href} key={task.href}>
        <span className="ec-home-task-number">{task.number}</span><div><h3>{task.title}</h3><p>{task.description}</p></div><span aria-hidden="true">↗</span>
      </Link>)}</div>
    </section>
    {isAdmin && <section className="ec-card ec-home-admin">
      <div className="ec-col"><h2 className="ec-h2">Administrar el ERP</h2><p className="ec-help">La configuración se mantiene separada del trabajo diario.</p></div>
      <div className="ec-actions"><Link className="ec-btn" href="/dashboard/imports">Importar productos y stock</Link><Link className="ec-btn" href="/dashboard/templates">Configurar catálogo</Link><Link className="ec-btn" href="/dashboard/users">Usuarios</Link><Link className="ec-btn" href="/dashboard/headquarters">Sedes</Link></div>
    </section>}
  </div>;
}
