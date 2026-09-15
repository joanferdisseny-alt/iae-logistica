"use client";
import { DialogFocus } from "@/app/dashboard/dialog-focus";

import { useState } from "react";
import { CreateInventoryItemForm } from "@/app/dashboard/inventory/create-item-form";
import type { InventoryTemplateDefinition } from "@/lib/inventory/templates";

type HeadquartersOption = {
  id: string;
  name: string;
};

type PlacementOption = {
  id: string;
  name: string;
  headquarters_id?: string | null;
};

export function CreateItemModal({
  canChooseHeadquarters,
  containers,
  headquarters,
  locations,
  templates,
  userHeadquartersId
}: {
  canChooseHeadquarters: boolean;
  containers: PlacementOption[];
  headquarters: HeadquartersOption[];
  locations: PlacementOption[];
  templates: InventoryTemplateDefinition[];
  userHeadquartersId: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="ec-btn ec-btn-primary ec-btn-block" onClick={() => setOpen(true)} type="button">
        Añadir articulo
      </button>

      {open ? (
        <div className="ec-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            aria-modal="true"
            className="ec-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          ><DialogFocus />
            <div className="ec-modal-header">
              <div className="ec-col">
                <div className="ec-muted-2">Nuevo articulo</div>
                <h2 className="ec-h2">Añadir artículo al inventario</h2>
              </div>
              <button className="ec-btn ec-btn-ghost" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>

            <div className="ec-modal-body">
              <CreateInventoryItemForm
                canChooseHeadquarters={canChooseHeadquarters}
                containers={containers}
                headquarters={headquarters}
                locations={locations}
                templates={templates}
                userHeadquartersId={userHeadquartersId}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
