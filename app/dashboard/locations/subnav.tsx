"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard/locations", label: "Cajas / kits" },
  { href: "/dashboard/locations/physical", label: "Ubicaciones físicas" }
];

export function LocationsSubnav() {
  const pathname = usePathname();

  return <nav className="ec-subnav" aria-label="Ubicaciones">
    {items.map(item => {
      const active = pathname === item.href;
      return <Link key={item.href} href={item.href}
        className={`ec-subnav-link ${active ? "is-active" : ""}`}
        aria-current={active ? "page" : undefined}>
        {item.label}
      </Link>;
    })}
  </nav>;
}
