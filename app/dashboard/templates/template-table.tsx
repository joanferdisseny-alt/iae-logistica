"use client";

import { Fragment, useId, useState, type ReactNode } from "react";

export type TemplateSummary = {
  id: string;
  name: string;
  category: string;
  fieldCount: number;
  details: ReactNode;
};

export function TemplateTable({ rows }: { rows: TemplateSummary[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prefix = useId();
  const toggle = (id: string) => setSelectedId((current) => current === id ? null : id);
  if (!rows.length) return <p className="ec-muted ec-template-empty">Todavía no hay fichas configuradas. Crea la primera con «Nueva ficha».</p>;

  return <div className="ec-template-table-wrap">
    <table className="ec-table ec-template-table">
      <caption className="ec-template-caption">Selecciona una ficha para ver sus detalles y gestionar sus campos.</caption>
      <colgroup><col className="ec-template-name-column" /><col /><col className="ec-template-count-column" /></colgroup>
      <thead><tr><th scope="col">Ficha</th><th scope="col">Categoría</th><th scope="col" className="ec-right">Campos</th></tr></thead>
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
