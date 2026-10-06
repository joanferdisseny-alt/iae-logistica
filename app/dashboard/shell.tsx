"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { currentWorkspaceLink, workspaceAreas } from "@/lib/navigation";

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7",
    box: "m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 5 9-5M12 12v9",
    pin: "M18 10c0 5-6 11-6 11S6 15 6 10a6 6 0 1 1 12 0ZM10 10h4",
    users: "M3 21v-2a5 5 0 0 1 10 0v2M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 8M17 15a5 5 0 0 1 4 5",
    settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
    logout: "M9 3H4v18h5M13 8l5 4-5 4M8 12h12",
    panel: "M3 4h18v16H3V4ZM9 4v16",
    menu: "M4 6h16M4 12h16M4 18h16"
  };
  return <svg className="ec-nav-icon" aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d={paths[name] ?? paths.box} /></svg>;
}

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
  const navigation = (mobile: boolean) => <>
    <div className="ec-erp-brand">
      <Link href={home} onClick={closeMenu} aria-label="IAE Logística, inicio"><img src="/logo_iae.png" alt="IAE Rescue" width="64" height="48" /></Link>
      <div className="ec-erp-brand-copy"><strong>IAE</strong><span>Logística y recursos</span></div>
      {mobile ? <button className="ec-erp-icon-button" type="button" onClick={closeMenu} aria-label="Cerrar menú">✕</button> :
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
            <Icon name={area.icon} /><span>{area.label}</span><span className="ec-erp-chevron" aria-hidden="true">{open ? "−" : "+"}</span>
          </button>
          <div id={id} className="ec-erp-nav-children" hidden={!open}>
            {area.links.map(link => <Link key={link.href} href={link.href} prefetch={false} onClick={closeMenu}
              aria-current={link.href === current?.link.href ? "page" : undefined}>{link.label}</Link>)}
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
          onClick={() => { drawer.current?.showModal(); setMenuOpen(true); }}><Icon name="menu" /></button>
        <nav aria-label="Ruta de navegación" className="ec-erp-breadcrumb"><Link href={home}>IAE</Link><span aria-hidden="true">/</span><span>{current?.area.label ?? "Inicio"}</span>{current && <><span aria-hidden="true">/</span><strong>{current.link.label}</strong></>}</nav>
        <span className="ec-erp-role">{roleName}</span>
      </header>
      {current && current.area.links.length > 1 && <nav className="ec-erp-tabs" ref={tabs} aria-label={current.area.label}>
        {current.area.links.map(link => <Link key={link.href} href={link.href} prefetch={false} aria-current={link.href === current.link.href ? "page" : undefined}>{link.label}</Link>)}
      </nav>}
      <div className="ec-main-inner">{children}</div>
    </main>
  </div>;
}
