"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ActionForm } from "@/app/dashboard/action-form";
import { DialogFocus } from "@/app/dashboard/dialog-focus";
import { moveInventoryCategory } from "@/app/dashboard/actions";

type CategoryOption = { code: string; name: string };

export function MoveCategoryModal({ category, categories }: {
  category: CategoryOption & { parent_code: string | null };
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  const parent = categories.find(option => option.code === category.parent_code);
  return <>
    <button className="ec-btn" type="button" aria-label={`Mover ${category.name}`} aria-haspopup="dialog"
      onClick={event => { event.stopPropagation(); setOpen(true); }}>Mover</button>
    {open && createPortal(
      <div className="ec-modal-backdrop" role="presentation" onClick={event => { event.stopPropagation(); setOpen(false); }}>
        <div className="ec-modal ec-modal-narrow" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
          <DialogFocus />
          <div className="ec-modal-header">
            <div className="ec-col"><span className="ec-help">Organizar categorías</span><h2 className="ec-h2">Mover {category.name}</h2></div>
            <button className="ec-btn ec-btn-ghost" type="button" onClick={() => setOpen(false)}>Cerrar</button>
          </div>
          <div className="ec-modal-body ec-stack">
            <p className="ec-help">Actualmente: {parent ? `dentro de ${parent.name}` : category.parent_code ? "categoría superior no disponible" : "categoría principal"}.</p>
            <ActionForm action={moveInventoryCategory} className="ec-stack">
              <input type="hidden" name="code" value={category.code} />
              <label className="ec-label">Nueva categoría superior
                <select className="ec-select" name="parentCode" defaultValue={category.parent_code ?? ""}>
                  <option value="">Ninguna: convertir en categoría principal</option>
                  {category.parent_code && !parent && <option value={category.parent_code} disabled>Categoría superior no disponible: selecciona otra</option>}
                  {categories.map(option => <option key={option.code} value={option.code}>{option.name}</option>)}
                </select>
              </label>
              <p className="ec-help">Elige otra categoría para convertirla en su subcategoría. Elige «Ninguna» para sacarla al nivel principal.</p>
              <p className="ec-help">Sus subcategorías se moverán con ella. No se cambian sus fichas, artículos, existencias ni códigos QR. No puede moverse dentro de sí misma ni de sus descendientes.</p>
              <button className="ec-btn ec-btn-primary" type="submit">Guardar organización</button>
            </ActionForm>
          </div>
        </div>
      </div>, document.body
    )}
  </>;
}
