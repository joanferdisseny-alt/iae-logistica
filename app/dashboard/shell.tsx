"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type DashboardShellProps = {
  children: ReactNode;
  roleCode: string;
  roleName: string;
  signOutAction: () => Promise<void>;
  userLabel: string;
};

type NavItem = {
  href: string;
  label: string;
  icon: "home" | "box" | "pin" | "template" | "building" | "users";
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Resumen", icon: "home" },
  { href: "/dashboard/inventory", label: "Inventario", icon: "box" },
  { href: "/dashboard/locations", label: "Ubicaciones", icon: "pin" },
  { href: "/dashboard/requests", label: "Solicitudes", icon: "box" },
  { href: "/dashboard/checklists", label: "Checklists", icon: "template" },
  { href: "/dashboard/receiving", label: "Recepción", icon: "box" },
  { href: "/dashboard/templates", label: "Fichas", icon: "template", adminOnly: true },
  { href: "/dashboard/headquarters", label: "Sedes", icon: "building", adminOnly: true },
  { href: "/dashboard/users", label: "Usuarios", icon: "users", adminOnly: true }
];

function NavIcon({ name }: { name: NavItem["icon"] }) {
  const commonProps = {
    "aria-hidden": true,
    className: "ec-nav-icon",
    fill: "none",
    viewBox: "0 0 24 24",
    xmlns: "http://www.w3.org/2000/svg"
  };

  if (name === "box") {
    return (
      <svg {...commonProps}>
        <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" />
        <path d="m4 8.5 8 4.5 8-4.5M12 13v7" />
      </svg>
    );
  }

  if (name === "pin") {
    return (
      <svg {...commonProps}>
        <path d="M12 21s6-5.2 6-11A6 6 0 0 0 6 10c0 5.8 6 11 6 11Z" />
        <path d="M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      </svg>
    );
  }

  if (name === "template") {
    return (
      <svg {...commonProps}>
        <path d="M4 5h16v14H4V5Z" />
        <path d="M8 5v14M4 10h16" />
      </svg>
    );
  }

  if (name === "building") {
    return (
      <svg {...commonProps}>
        <path d="M5 21V5l8-2v18M13 8h6v13" />
        <path d="M8 8h2M8 12h2M8 16h2M16 12h1M16 16h1M4 21h17" />
      </svg>
    );
  }

  if (name === "users") {
    return (
      <svg {...commonProps}>
        <path d="M16 20v-1.5c0-2-1.8-3.5-4-3.5s-4 1.5-4 3.5V20" />
        <path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 20v-1.2c0-1.5-1-2.7-2.5-3.3M16 6.3a2.5 2.5 0 0 1 0 4.4" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M4 10.5 12 4l8 6.5V20H5.5v-6.5H4v-3Z" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

export function DashboardShell({
  children,
  roleCode,
  roleName,
  signOutAction,
  userLabel
}: DashboardShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const visibleItems = navItems.filter((item) => !item.adminOnly || roleCode === "admin");
  const currentItem =
    visibleItems.find(
      (item) => pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
    ) ?? visibleItems[0];

  return (
    <div className={`ec-app ${menuCollapsed ? "ec-app-collapsed" : ""}`}>
      <button
        aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
        className="ec-menu-toggle"
        onClick={() => setMenuOpen((open) => !open)}
        type="button"
      >
        <span />
        <span />
        <span />
      </button>

      {menuOpen ? (
        <button
          aria-label="Cerrar menú"
          className="ec-sidebar-scrim"
          onClick={() => setMenuOpen(false)}
          type="button"
        />
      ) : null}

      <aside className={`ec-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="ec-sidebar-top">
          <div className="ec-sidebar-brand">
            <img alt="IAE Rescue" className="ec-sidebar-logo" src="/logo_iae.png" />
            <div className="ec-sidebar-brand-copy">
              <div className="ec-sidebar-kicker">IAE Logistica</div>
              <strong>Panel operativo</strong>
            </div>
          </div>
          <button
            aria-label={menuCollapsed ? "Mostrar menú lateral" : "Esconder menú lateral"}
            aria-pressed={menuCollapsed}
            className="ec-sidebar-icon-button"
            onClick={() => setMenuCollapsed((collapsed) => !collapsed)}
            title={menuCollapsed ? "Mostrar menú" : "Esconder menú"}
            type="button"
          >
            <span className="ec-panel-icon" aria-hidden="true" />
          </button>
        </div>

        <div className="ec-sidebar-user">
          <div className="ec-user-avatar" aria-hidden="true">
            {userLabel.slice(0, 2).toUpperCase()}
          </div>
          <div className="ec-sidebar-user-copy">
            <div className="ec-muted-2">Sesión</div>
            <strong>{userLabel}</strong>
            <span className="ec-badge ec-badge-neutral">{roleName}</span>
          </div>
        </div>

        <nav className="ec-sidebar-nav">
          {visibleItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

            return (
              <Link
                className={`ec-sidebar-link ${active ? "is-active" : ""}`}
                href={item.href}
                key={item.href}
                onClick={() => setMenuOpen(false)}
                title={item.label}
              >
                <NavIcon name={item.icon} />
                <span className="ec-sidebar-link-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <form action={signOutAction} className="ec-sidebar-logout">
          <button className="ec-sidebar-link ec-sidebar-button" title="Cerrar sesión" type="submit">
            <span className="ec-nav-icon ec-logout-icon" aria-hidden="true" />
            <span className="ec-sidebar-link-label">Cerrar sesión</span>
          </button>
        </form>
      </aside>

      <main className="ec-main">
        <header className="ec-mobile-topbar">
          <img alt="IAE Rescue" className="ec-mobile-logo" src="/logo_iae.png" />
          <div>
            <div className="ec-muted-2">Sección</div>
            <strong>{currentItem?.label ?? "Panel"}</strong>
          </div>
        </header>
        <div className="ec-main-inner">{children}</div>
      </main>

      <nav className="ec-mobile-nav">
        {visibleItems.slice(0, 5).map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

          return (
            <Link className={`ec-mobile-nav-link ${active ? "is-active" : ""}`} href={item.href} key={item.href}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
