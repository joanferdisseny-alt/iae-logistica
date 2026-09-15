"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard/templates/categories", label: "Categorias" },
  { href: "/dashboard/templates", label: "Fichas" },
  { href: "/dashboard/templates/fields", label: "Campos" }
];

export function TemplatesSubnav() {
  const pathname = usePathname();

  return (
    <div className="ec-subnav">
      {items.map((item) => {
        const active = pathname === item.href;

        return (
          <Link className={`ec-subnav-link ${active ? "is-active" : ""}`} href={item.href} key={item.href}>
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
