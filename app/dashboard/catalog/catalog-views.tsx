import Link from "next/link";
import { Icon } from "../icons";

export function CatalogViews({ view, category = "", headquarters = "", q = "" }: {
  view: "folders" | "list"; category?: string; headquarters?: string; q?: string;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ category, headquarters, q })) if (value) params.set(key, value);
  const suffix = params.size ? `?${params}` : "";
  return <nav className="ec-catalog-views" aria-label="Vistas de productos">
    <Link href={`/dashboard/catalog${suffix}`} prefetch={false} aria-current={view === "folders" ? "page" : undefined}><Icon name="folder" />Por categorías</Link>
    <Link href={`/dashboard/inventory${suffix}`} prefetch={false} aria-current={view === "list" ? "page" : undefined}><Icon name="list" />Listado y stock</Link>
  </nav>;
}
