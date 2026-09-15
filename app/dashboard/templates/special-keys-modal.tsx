"use client";
import { DialogFocus } from "@/app/dashboard/dialog-focus";

import { useState } from "react";

const specialKeys = [
  { key: "item_name", description: "Nombre principal del articulo." },
  { key: "current_stock", description: "Stock actual para calcular disponibilidad." },
  { key: "minimum_stock", description: "Stock minimo para avisos de reposicion." },
  { key: "unit", description: "Unidad de medida, por ejemplo unidad, caja o saco." },
  { key: "expiration_date", description: "Fecha de caducidad usada para alertas y emails." },
  { key: "maintenance_due_at", description: "Proxima fecha de mantenimiento." },
  { key: "description", description: "Descripcion general del articulo." },
  { key: "sku", description: "Codigo interno o referencia." },
  { key: "serial_number", description: "Numero de serie si aplica." },
  { key: "subtype", description: "Subtipo operativo dentro de la categoria." },
  { key: "location_id", description: "UUID de una ubicacion existente en la base de datos." }
];

export function SpecialKeysModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(true)} type="button">
        Ver claves especiales
      </button>

      {open ? (
        <div className="ec-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            aria-modal="true"
            className="ec-modal ec-modal-narrow"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          ><DialogFocus />
            <div className="ec-modal-header">
              <div className="ec-col">
                <div className="ec-muted-2">Ayuda</div>
                <h2 className="ec-h2">Claves especiales</h2>
              </div>
              <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>

            <div className="ec-modal-body ec-stack">
              <p className="ec-muted">
                Usa estas claves cuando quieras que un campo tenga un comportamiento especial dentro
                del inventario o en los avisos automáticos.
              </p>

              <div className="ec-list">
                {specialKeys.map((item) => (
                  <div className="ec-list-item ec-list-item-block" key={item.key}>
                    <div className="ec-col">
                      <strong>{item.key}</strong>
                      <div className="ec-help">{item.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
