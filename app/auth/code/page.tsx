import Link from "next/link";
import { AccessCodeForm } from "./form";

export default async function CodePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const mode = (await searchParams).mode === "recover" ? "recover" : "activate";
  return <main className="ec-page" style={{ minHeight: "100vh", alignContent: "center" }}>
    <section className="ec-card" style={{ maxWidth: 560, width: "100%", margin: "0 auto" }}>
      <div className="ec-card-header"><h1 className="ec-h2">{mode === "recover" ? "Recuperar contraseña" : "Activar mi cuenta"}</h1></div>
      <div className="ec-card-body ec-stack"><AccessCodeForm key={mode} mode={mode} /><Link className="ec-btn ec-btn-ghost" href="/auth/sign-in">Volver al inicio de sesión</Link></div>
    </section>
  </main>;
}
