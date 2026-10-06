"use client";

import { Fragment, useDeferredValue, useId, useState, type ReactNode } from "react";

export type CatalogSummary = {
  id: string;
  label: string;
  cells: ReactNode[];
  details: ReactNode;
  searchText?: string;
};

type CatalogTableProps = {
  rows: CatalogSummary[];
  columns: { label: string; className?: string }[];
  caption: string;
  emptyMessage: string;
  searchable?: boolean;
};

const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

function SearchableCatalog(props: CatalogTableProps) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const filtered = props.rows.filter(row => normalizeSearch(`${row.label} ${row.searchText ?? ""}`).includes(normalizeSearch(deferred.trim())));
  return <>
    <div className="ec-catalog-search"><label className="ec-label">Buscar en este catálogo<input className="ec-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o código…" /></label><span className="ec-help" role="status">{filtered.length} de {props.rows.length}</span></div>
    <div aria-busy={query !== deferred}><CatalogTable {...props} rows={filtered} searchable={false} emptyMessage={query ? "No hay coincidencias. Prueba otro nombre o código." : props.emptyMessage} /></div>
  </>;
}

export function CatalogTable({ rows, columns, caption, emptyMessage, searchable = false }: CatalogTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prefix = useId();
  const toggle = (id: string) => setSelectedId(current => current === id ? null : id);
  if (searchable && rows.length) return <SearchableCatalog rows={rows} columns={columns} caption={caption} emptyMessage={emptyMessage} />;
  if (!rows.length) return <p className="ec-muted ec-template-empty">{emptyMessage}</p>;

  return <div className="ec-template-table-wrap">
    <table className="ec-table ec-template-table">
      <caption className="ec-template-caption">{caption}</caption>
      <colgroup>{columns.map(column => <col key={column.label} className={column.className} />)}</colgroup>
      <thead><tr>{columns.map(column => <th key={column.label} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{rows.map(row => {
        const expanded = selectedId === row.id;
        const buttonId = `${prefix}-${row.id}-toggle`;
        const detailsId = `${prefix}-${row.id}-details`;
        return <Fragment key={row.id}>
          <tr className={`ec-template-summary${expanded ? " is-expanded" : ""}`} onClick={() => toggle(row.id)}>
            <th scope="row">
              <button id={buttonId} type="button" className="ec-template-toggle" aria-expanded={expanded} aria-controls={detailsId}
                onClick={event => { event.stopPropagation(); toggle(row.id); }}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{row.label}</span>
              </button>
            </th>
            {row.cells.map((cell, index) => <td key={columns[index + 1].label}><span className="ec-template-category">{cell}</span></td>)}
          </tr>
          <tr id={detailsId} hidden={!expanded} className="ec-template-expanded-row">
            <td colSpan={columns.length}>{expanded && <section className="ec-template-detail" aria-labelledby={buttonId}>{row.details}</section>}</td>
          </tr>
        </Fragment>;
      })}</tbody>
    </table>
  </div>;
}
