"use client";

import { Fragment, useDeferredValue, useId, useState, type ReactNode } from "react";

export type TemplateSummary = {
  id: string;
  name: string;
  category: string;
  fieldCount: number;
  details: ReactNode;
};

function SearchableTemplates({ rows }: { rows: TemplateSummary[] }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const filtered = rows.filter(row => normalize(`${row.name} ${row.category}`).includes(normalize(deferred.trim())));
  return <>
    <div className="ec-catalog-search"><label className="ec-label">Buscar tipo de artículo<input className="ec-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o categoría…" /></label><span className="ec-help" role="status">{filtered.length} de {rows.length}</span></div>
    <div aria-busy={query !== deferred}>{filtered.length ? <TemplateTable rows={filtered} /> : <p className="ec-template-empty ec-muted">No hay coincidencias. Prueba otro nombre o categoría.</p>}</div>
  </>;
}

export function TemplateTable({ rows, searchable = false }: { rows: TemplateSummary[]; searchable?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prefix = useId();
  const toggle = (id: string) => setSelectedId((current) => current === id ? null : id);
  if (searchable && rows.length) return <SearchableTemplates rows={rows} />;
  if (!rows.length) return <p className="ec-muted ec-template-empty">Todavía no hay tipos de artículo. Crea el primero con «Nuevo tipo».</p>;

  return <div className="ec-template-table-wrap">
    <table className="ec-table ec-template-table">
      <caption className="ec-template-caption">Selecciona un tipo de artículo para editar su ficha y añadir campos.</caption>
      <colgroup><col className="ec-template-name-column" /><col /><col className="ec-template-count-column" /></colgroup>
      <thead><tr><th scope="col">Tipo de artículo</th><th scope="col">Categoría</th><th scope="col" className="ec-right">Campos</th></tr></thead>
      <tbody>{rows.map((row) => {
        const expanded = selectedId === row.id;
        const buttonId = `${prefix}-${row.id}-toggle`;
        const detailsId = `${prefix}-${row.id}-details`;
        return <Fragment key={row.id}>
          <tr className={`ec-template-summary${expanded ? " is-expanded" : ""}`} onClick={() => toggle(row.id)}>
            <th scope="row">
              <button id={buttonId} type="button" className="ec-template-toggle"
                aria-expanded={expanded} aria-controls={detailsId}
                onClick={(event) => { event.stopPropagation(); toggle(row.id); }}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{row.name}</span>
              </button>
            </th>
            <td><span className="ec-template-category">{row.category}</span></td>
            <td className="ec-right"><span className="ec-template-count">{row.fieldCount}</span></td>
          </tr>
          <tr id={detailsId} hidden={!expanded} className="ec-template-expanded-row">
            <td colSpan={3}>{expanded && <section className="ec-template-detail" aria-labelledby={buttonId}>{row.details}</section>}</td>
          </tr>
        </Fragment>;
      })}</tbody>
    </table>
  </div>;
}
