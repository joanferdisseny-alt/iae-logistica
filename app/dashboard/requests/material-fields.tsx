"use client";

import { useEffect, useId, useState } from "react";
import { searchRequestArticles } from "./actions";
import type { RequestArticle } from "./model";

function ArticleSearch({ headquartersId, onSelect }: {
  headquartersId: string; onSelect: (article: RequestArticle) => void;
}) {
  const hintId = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    term: string; articles: RequestArticle[]; error?: string; hasMore?: boolean;
  } | null>(null);
  const term = query.trim();
  useEffect(() => {
    if (term.length < 2) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      searchRequestArticles(term, headquartersId).then((response) => {
        if (!cancelled) setResult({ ...response, term });
      }).catch(() => {
        if (!cancelled) setResult({ term, articles: [], error: "No se pudo completar la búsqueda. Revisa tu conexión o sesión." });
      });
    }, 300);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [term, headquartersId]);
  const current = result?.term === term ? result : null;
  return <div className="ec-stack">
    <label className="ec-label"><span>Buscar artículo del inventario (opcional)</span>
      <input type="search" autoFocus className="ec-input" value={query} maxLength={100}
        placeholder="Escribe el nombre del artículo" aria-describedby={hintId}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
    </label>
    <p id={hintId} className="ec-help">Busca por nombre, con al menos 2 caracteres. Sólo se muestran artículos de esta sede.</p>
    {term.length >= 2 && <>
      <p className={current?.error ? "ec-error" : "ec-help"} role="status">
        {!current ? "Buscando..." : current.error || (current.articles.length
          ? `${current.articles.length} resultados.${current.hasMore ? " Afina la búsqueda para ver más artículos." : " Selecciona un artículo."}`
          : "No hay coincidencias. Puedes escribir el material manualmente debajo.")}
      </p>
      {!!current?.articles.length && <ul className="ec-request-search-results" aria-label="Artículos encontrados">
        {current.articles.map((article) => <li key={article.id}>
          <button className="ec-btn ec-request-search-result" type="button" onClick={() => onSelect(article)}>
            <strong>{article.name}</strong>
            <span className="ec-help">{article.sku ? `${article.sku} · ` : ""}Stock: {article.current_stock} {article.unit || "unidades"}</span>
          </button>
        </li>)}
      </ul>}
    </>}
  </div>;
}

export function RequestMaterialFields({ headquartersId }: { headquartersId: string }) {
  const [selected, setSelected] = useState<RequestArticle | null>(null);
  const [material, setMaterial] = useState("");
  const [unit, setUnit] = useState("unidades");
  return <>
    <input type="hidden" name="itemId" value={selected?.id ?? ""} />
    {selected ? <div className="ec-row ec-row-between ec-row-wrap">
      <span className="ec-help" role="status">Artículo vinculado: {selected.name}</span>
      <button type="button" className="ec-btn" onClick={() => { setSelected(null); setMaterial(""); setUnit("unidades"); }}>Cambiar / quitar</button>
    </div> : <ArticleSearch headquartersId={headquartersId} onSelect={(article) => {
      setSelected(article); setMaterial(article.name.slice(0, 160)); setUnit((article.unit?.trim() || "unidades").slice(0, 40));
    }} />}
    <label className="ec-label"><span>{selected ? "Material referenciado" : "Material (si no seleccionas un artículo)"}</span>
      <input className="ec-input" name="material" required minLength={2} maxLength={160}
        value={material} readOnly={!!selected} onChange={(event) => setMaterial(event.target.value)} />
    </label>
    <div className="ec-form-grid">
      <label className="ec-label"><span>Cantidad solicitada</span>
        <input className="ec-input" name="quantity" type="number" required min="0.001" max="999999999.999" step="0.001" defaultValue="1" />
      </label>
      <label className="ec-label"><span>Unidad</span>
        <input className="ec-input" name="unit" required maxLength={40} value={unit}
          readOnly={!!selected} onChange={(event) => setUnit(event.target.value)} />
      </label>
    </div>
  </>;
}
