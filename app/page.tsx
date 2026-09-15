import Link from "next/link";

const inventoryFamilies = [
  {
    title: "Herramientas y materiales",
    description:
      "Fichas con fotos, estado, ubicación, número de serie, especificaciones técnicas y trazabilidad."
  },
  {
    title: "Consumibles y reposición",
    description:
      "Control de stock mínimo, alertas por reposición y seguimiento de materiales fungibles."
  },
  {
    title: "Alimentos y caducidades",
    description:
      "Lotes, fechas de caducidad, avisos anticipados y visibilidad para compras o retirada."
  }
];

const roadmap = [
  {
    step: "Fase 1",
    detail: "Arranque de Supabase, autenticación, perfiles y roles administrados por el equipo."
  },
  {
    step: "Fase 2",
    detail: "CRUD de inventario, carga de imágenes, etiquetas, ubicaciones y entradas/salidas."
  },
  {
    step: "Fase 3",
    detail: "Alertas de caducidad, mínimos de stock y panel operativo para administración."
  }
];

export default function HomePage() {
  return (
    <main className="ec-page">
      <section className="ec-card">
        <div className="ec-card-header">
          <div className="ec-col">
            <div className="ec-muted-2">IAE Logistica · Base inicial</div>
            <h1 className="ec-h1">Inventario operativo para rescate y logística humanitaria.</h1>
          </div>
        </div>
        <div className="ec-card-body ec-stack">
          <p className="ec-muted">
            Esta primera base está preparada para levantar una aplicación con Next.js,
            Supabase y Vercel. El objetivo es centralizar materiales, herramientas,
            consumibles y alimentos, con permisos por rol y alertas accionables.
          </p>

          <div className="ec-stat-grid">
            <article className="ec-stat">
              <strong>4</strong>
              dominios base
            </article>
            <article className="ec-stat">
              <strong>3</strong>
              niveles de acceso
            </article>
            <article className="ec-stat">
              <strong>1</strong>
              flujo de despliegue
            </article>
          </div>

          <div className="ec-actions">
            <Link className="ec-btn ec-btn-primary" href="/dashboard">
              Abrir panel
            </Link>
            <Link className="ec-btn" href="/auth/sign-in">
              Iniciar sesión
            </Link>
          </div>
        </div>
      </section>

      <section className="ec-grid-3">
        <article className="ec-card">
          <div className="ec-card-header">
            <h2 className="ec-h2">Modelo inicial</h2>
          </div>
          <div className="ec-card-body ec-list">
            <div className="ec-list-item">
              <div>
                <strong>Administrador</strong>
                <div className="ec-muted">Gestiona usuarios, permisos, catálogo y alertas.</div>
              </div>
              <span className="ec-badge ec-badge-neutral">Full</span>
            </div>
            <div className="ec-list-item">
              <div>
                <strong>Operador</strong>
                <div className="ec-muted">Registra entradas/salidas y actualiza fichas.</div>
              </div>
              <span className="ec-badge ec-badge-neutral">Edit</span>
            </div>
            <div className="ec-list-item">
              <div>
                <strong>Consulta</strong>
                <div className="ec-muted">Visualiza stock, estado y próximos vencimientos.</div>
              </div>
              <span className="ec-badge ec-badge-neutral">Read</span>
            </div>
          </div>
        </article>
      </section>

      <section className="ec-grid-3">
        {inventoryFamilies.map((item) => (
          <article className="ec-card" key={item.title}>
            <div className="ec-card-header">
              <h2 className="ec-h2">{item.title}</h2>
            </div>
            <div className="ec-card-body">
              <p className="ec-muted">{item.description}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="ec-card">
        <div className="ec-card-header">
          <h2 className="ec-h2">Ruta de construcción</h2>
        </div>
        <div className="ec-card-body ec-list">
          {roadmap.map((item) => (
            <article className="ec-list-item" key={item.step}>
              <strong>{item.step}</strong>
              <div className="ec-muted">{item.detail}</div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
