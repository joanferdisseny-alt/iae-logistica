import Link from "next/link";
import { SignInForm } from "@/app/auth/sign-in/form";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/dashboard";

  return (
    <main className="ec-page" style={{ minHeight: "100vh", alignContent: "center" }}>
      <section className="ec-card" style={{ maxWidth: 560, width: "100%", margin: "0 auto" }}>
        <div className="ec-card-header">
          <div className="ec-col">
            <div className="ec-muted-2">Acceso seguro</div>
            <h1 className="ec-h1">Inicia sesión para gestionar el inventario operativo.</h1>
          </div>
        </div>
        <div className="ec-card-body ec-stack">
          <p className="ec-muted">
            Acceso para miembros de la ONG. Contacta con un administrador para obtener una cuenta.
          </p>

          <SignInForm next={next} />
          {params.reason ? <p className="ec-error" role="alert">{params.reason === "headquarters" ? "Tu cuenta necesita una sede asignada. Contacta con un administrador." : "Tu cuenta está inactiva o no tiene permisos. Contacta con un administrador."}</p> : null}

          <p className="ec-help">
            Cada miembro accede únicamente a los recursos autorizados de su sede.
          </p>

          <Link className="ec-btn ec-btn-ghost" href="/">
            Volver a la portada
          </Link>
        </div>
      </section>
    </main>
  );
}
