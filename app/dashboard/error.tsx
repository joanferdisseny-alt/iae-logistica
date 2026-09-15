"use client";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return <section className="ec-card"><div className="ec-card-body ec-stack" role="alert">
    <h1 className="ec-h1">No se ha podido cargar esta sección</h1>
    <p>La información no está disponible en este momento. No se han mostrado listas vacías como si no hubiera recursos.</p>
    <button type="button" className="ec-btn" onClick={reset}>Volver a intentar</button>
  </div></section>;
}
