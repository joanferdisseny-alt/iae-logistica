"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { searchWorkspaceLinks } from "@/lib/navigation";
import { Icon } from "./icons";

export function QuickNavigation({ roleCode }: { roleCode: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const links = searchWorkspaceLinks(roleCode, query);
  const show = () => { setQuery(""); dialog.current?.showModal(); setOpen(true); input.current?.focus(); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" || event.altKey || event.repeat) return;
      // Do not interrupt an editing dialog or discard its keyboard focus.
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      event.preventDefault(); setQuery(""); dialog.current?.showModal(); setOpen(true); input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; };
  }, [open]);

  return <>
    <button type="button" className="ec-quick-trigger" onClick={show} aria-label="Ir a una sección" aria-haspopup="dialog" aria-expanded={open}>
      <Icon name="search" /><span>Ir a…</span><kbd>Ctrl / ⌘ K</kbd>
    </button>
    <dialog ref={dialog} className="ec-quick-dialog" aria-labelledby={titleId} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="ec-quick-inner">
        <header><div><h2 id={titleId} className="ec-h2">¿Dónde quieres ir?</h2><p className="ec-help">Accede a una sección sin recorrer el menú.</p></div>
          <button className="ec-btn ec-icon-button" type="button" onClick={() => dialog.current?.close()} aria-label="Cerrar navegación rápida"><Icon name="close" /></button>
        </header>
        <label className="ec-sr-only" htmlFor={`${titleId}-search`}>Buscar sección</label>
        <div className="ec-quick-input"><Icon name="search" /><input ref={input} id={`${titleId}-search`} className="ec-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Categorías, cajas, usuarios…"
          onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "Enter") { event.preventDefault(); dialog.current?.querySelector<HTMLAnchorElement>(".ec-quick-results a")?.focus(); } }} /></div>
        <nav className="ec-quick-results" aria-label="Resultados de secciones">
          {links.map(link => <Link key={link.href} href={link.href} prefetch={false} onClick={() => dialog.current?.close()}><Icon name={link.icon ?? "list"} /><span><strong>{link.label}</strong><small>{link.area}</small></span><Icon name="arrow" /></Link>)}
        </nav>
        {!links.length && <p className="ec-help" role="status">No hay secciones con ese nombre.</p>}
        {roleCode !== "volunteer" && <footer><Link href="/dashboard/inventory" prefetch={false} onClick={() => dialog.current?.close()}>¿Buscas un artículo? Abrir el buscador de inventario <Icon name="arrow" /></Link></footer>}
      </div>
    </dialog>
  </>;
}
