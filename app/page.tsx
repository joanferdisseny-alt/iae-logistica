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

const workflow = [
  {
    step: "Localiza",
    detail: "Consulta el material de cada sede y su reparto entre ubicaciones físicas y cajas."
  },
  {
    step: "Prepara",
    detail: "Revisa existencias, estado operativo y necesidades de material antes de una actividad."
  },
  {
    step: "Comprueba",
    detail: "Registra el retorno con un checklist de la caja y deja constancia de las incidencias."
  }
];

export default function HomePage() {
  return (
    <main className="ec-page">
      <section className="ec-card">
        <div className="ec-card-header">
          <div className="ec-col">
            <div className="ec-muted-2">IAE Logística · Gestión de recursos</div>
            <h1 className="ec-h1">Inventario operativo para rescate y logística humanitaria.</h1>
          </div>
        </div>
        <div className="ec-card-body ec-stack">
          <p className="ec-muted">
            Herramientas, consumibles, equipos y alimentos de la ONG en un único
            inventario. Cada sede consulta sus recursos, ubicaciones y cajas,
            con acceso según las responsabilidades de cada miembro.
          </p>

          <div className="ec-stat-grid">
            <article className="ec-stat">
              <strong>Sedes</strong>
              Recursos organizados por sede
            </article>
            <article className="ec-stat">
              <strong>Inventario</strong>
              Existencias, lotes y ubicaciones
            </article>
            <article className="ec-stat">
              <strong>Cajas</strong>
              Intervención y prácticas
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
            <h2 className="ec-h2">Acceso por responsabilidades</h2>
          </div>
          <div className="ec-card-body ec-list">
            <div className="ec-list-item">
              <div>
                <strong>Administrador</strong>
                <div className="ec-muted">Gestiona todas las sedes, usuarios, catálogo, existencias y avisos.</div>
              </div>
              <span className="ec-badge ec-badge-neutral">Administración</span>
            </div>
            <div className="ec-list-item">
              <div>
                <strong>Editor</strong>
                <div className="ec-muted">Consulta los recursos de su sede y crea fichas de artículos.</div>
              </div>
              <span className="ec-badge ec-badge-neutral">Alta</span>
            </div>
            <div className="ec-list-item">
              <div>
                <strong>Lector</strong>
                <div className="ec-muted">Consulta el inventario, estado y ubicación de los recursos de su sede.</div>
              </div>
              <span className="ec-badge ec-badge-neutral">Consulta</span>
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
          <h2 className="ec-h2">Antes y después de cada actividad</h2>
        </div>
        <div className="ec-card-body ec-list">
          {workflow.map((item) => (
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
