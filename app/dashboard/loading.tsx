export default function DashboardLoading() {
  return <section className="ec-card ec-workspace-loading" role="status" aria-live="polite" aria-busy="true">
    <div className="ec-card-body"><strong>Cargando datos de tu sede…</strong><p className="ec-help">Un momento, estamos preparando esta sección.</p>
      <div className="ec-loading-line" /><div className="ec-loading-line" /><div className="ec-loading-line" />
    </div>
  </section>;
}
