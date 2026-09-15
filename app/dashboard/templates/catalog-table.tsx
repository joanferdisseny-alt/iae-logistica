"use client";

import { Fragment, useId, useState, type ReactNode } from "react";

export type CatalogSummary = {
  id: string;
  label: string;
  cells: ReactNode[];
  details: ReactNode;
};

export function CatalogTable({ rows, columns, caption, emptyMessage }: {
  rows: CatalogSummary[];
  columns: { label: string; className?: string }[];
  caption: string;
  emptyMessage: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prefix = useId();
  const toggle = (id: string) => setSelectedId(current => current === id ? null : id);
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
