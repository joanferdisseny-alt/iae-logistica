"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { currentWorkspaceLink, workspaceAreas } from "@/lib/navigation";
import { Icon, type IconName } from "./icons";
import { QuickNavigation } from "./quick-navigation";

export function DashboardShell({ children, roleCode, roleName, signOutAction, userLabel }: {
  children: ReactNode; roleCode: string; roleName: string; signOutAction: () => Promise<void>; userLabel: string;
}) {
  const pathname = usePathname();
  const areas = workspaceAreas(roleCode);
  const current = currentWorkspaceLink(areas, pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const tabs = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const home = roleCode === "volunteer" ? "/dashboard/personal" : "/dashboard";
  const shortcuts: { href: string; label: string; icon: IconName }[] = roleCode === "volunteer" ? [
    { href: "/dashboard/personal", label: "Mi material", icon: "personal" },
    { href: "/dashboard/requests", label: "Solicitudes", icon: "request" }
  ] : [
    { href: home, label: "Inicio", icon: "home" },
    { href: "/dashboard/catalog", label: "Catálogo", icon: "catalog" },
    { href: "/dashboard/locations", label: "Cajas", icon: "box" },
    { href: "/dashboard/personal", label: "Mi material", icon: "personal" }
  ];

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("iae-sidebar-collapsed") === "true"); } catch {}
  }, []);
  useEffect(() => {
    drawer.current?.close();
    setExpanded(null);
    const nav = tabs.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && link) nav.scrollLeft += link.getBoundingClientRect().left - nav.getBoundingClientRect().left - 12;
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 901px)");
    const closeOnDesktop = () => { if (desktop.matches) drawer.current?.close(); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => { document.body.style.overflow = before; desktop.removeEventListener("change", closeOnDesktop); };
  }, [menuOpen]);

  const closeMenu = () => drawer.current?.close();
  const openMenu = () => { drawer.current?.showModal(); setMenuOpen(true); };
  const navigation = (mobile: boolean) => <>
    <div className="ec-erp-brand">
      <Link href={home} onClick={closeMenu} aria-label="IAE Logística, inicio"><img src="/logo_iae.png" alt="IAE Rescue" width="64" height="48" /></Link>
      <div className="ec-erp-brand-copy"><strong>IAE</strong><span>Logística y recursos</span></div>
      {mobile ? <button className="ec-erp-icon-button" type="button" onClick={closeMenu} aria-label="Cerrar menú"><Icon name="close" /></button> :
        <button type="button" className="ec-erp-icon-button ec-erp-collapse" aria-label={collapsed ? "Ampliar menú" : "Reducir menú"} aria-expanded={!collapsed}
          onClick={() => { const next = !collapsed; setCollapsed(next); try { localStorage.setItem("iae-sidebar-collapsed", String(next)); } catch {} }}><Icon name="panel" /></button>}
    </div>
    <nav className="ec-erp-navigation" aria-label={mobile ? "Menú móvil" : "Menú principal"}>
      {roleCode !== "volunteer" && <Link href={home} prefetch={false} className={`ec-erp-nav-heading ${pathname === home ? "is-active" : ""}`} aria-current={pathname === home ? "page" : undefined} title="Inicio" onClick={closeMenu}>
        <Icon name="home" /><span>Inicio</span>
      </Link>}
      {areas.map(area => {
        const active = area.id === current?.area.id;
        const open = (mobile || !collapsed) && (expanded === area.id || (expanded === null && active));
        const id = `${mobile ? "mobile" : "desktop"}-${area.id}`;
        return <div className="ec-erp-nav-group" key={area.id}>
          <button type="button" className={`ec-erp-nav-heading ${active ? "is-active" : ""}`} aria-expanded={open} aria-controls={id} title={area.label}
            onClick={() => { if (!mobile && collapsed) { setCollapsed(false); try { localStorage.setItem("iae-sidebar-collapsed", "false"); } catch {} } setExpanded(open ? "" : area.id); }}>
            <Icon name={area.icon} /><span>{area.label}</span><Icon name="chevron" className={`ec-erp-chevron ${open ? "is-open" : ""}`} />
          </button>
          <div id={id} className="ec-erp-nav-children" hidden={!open}>
            {area.links.map(link => <Link key={link.href} href={link.href} prefetch={false} onClick={closeMenu}
              aria-current={link.href === current?.link.href ? "page" : undefined}><Icon name={link.icon ?? "list"} /><span>{link.label}</span></Link>)}
          </div>
        </div>;
      })}
    </nav>
    <div className="ec-erp-account">
      <div className="ec-erp-avatar" aria-hidden="true">{userLabel.slice(0, 2).toUpperCase()}</div>
      <div className="ec-erp-account-copy"><strong title={userLabel}>{userLabel}</strong><span>{roleName}</span></div>
      <form action={signOutAction}><button type="submit" className="ec-erp-icon-button" title="Cerrar sesión" aria-label="Cerrar sesión"><Icon name="logout" /></button></form>
    </div>
  </>;

  return <div className={`ec-app ec-erp ${collapsed ? "ec-erp-collapsed" : ""}`}>
    <a className="ec-skip-link" href="#workspace">Ir al contenido</a>
    <aside className="ec-erp-sidebar">{navigation(false)}</aside>
    <dialog className="ec-erp-drawer" ref={drawer} aria-label="Navegación" onClose={() => setMenuOpen(false)} onClick={event => { if (event.target === event.currentTarget) closeMenu(); }}>
      <div className="ec-erp-drawer-body">{navigation(true)}</div>
    </dialog>
    <main className="ec-main" id="workspace" tabIndex={-1}>
      <header className="ec-erp-topbar">
        <button type="button" className="ec-erp-mobile-toggle ec-btn" aria-label="Abrir menú" aria-haspopup="dialog" aria-expanded={menuOpen}
          onClick={openMenu}><Icon name="menu" /></button>
        <nav aria-label="Ruta de navegación" className="ec-erp-breadcrumb"><Link href={home}>IAE</Link><span aria-hidden="true">/</span><span>{current?.area.label ?? "Inicio"}</span>{current && <><span aria-hidden="true">/</span><strong>{current.link.label}</strong></>}</nav>
        <div className="ec-erp-topbar-actions"><QuickNavigation roleCode={roleCode} /><span className="ec-erp-role">{roleName}</span></div>
      </header>
      {current && current.area.links.length > 1 && <nav className="ec-erp-tabs" ref={tabs} aria-label={current.area.label}>
        {current.area.links.map(link => <Link key={link.href} href={link.href} prefetch={false} aria-current={link.href === current.link.href ? "page" : undefined}>{link.label}</Link>)}
      </nav>}
      <div className="ec-main-inner">{children}</div>
    </main>
    <nav className="ec-mobile-dock" aria-label="Accesos rápidos">
      {shortcuts.map(link => <Link key={link.href} href={link.href} prefetch={false}
        aria-current={pathname === link.href || current?.link.href === link.href || (link.href === "/dashboard/catalog" && current?.area.id === "catalog") ? "page" : undefined}>
        <Icon name={link.icon} /><span>{link.label}</span>
      </Link>)}
      <button type="button" onClick={openMenu} aria-haspopup="dialog" aria-expanded={menuOpen} aria-label="Abrir todas las secciones"><Icon name="menu" /><span>Menú</span></button>
    </nav>
  </div>;
}
