"use server";

import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/context";
import { stockSchema } from "./stock-model";

export async function manageStock(form: FormData): Promise<{ error?: string; success?: string; retry?: boolean }> {
  const { isAdmin, supabase } = await requireAccess();
  if (!isAdmin) return { error: "Solo administración puede modificar existencias." };
  const parsed = stockSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Revisa los datos." };
  const v = parsed.data;
  const hasDestination = ["in","transfer","new_lot"].includes(v.operation);
  try {
    const { error } = await supabase.rpc("manage_inventory_stock", {
      p_request_id: v.requestId, p_item_id: v.itemId, p_action: v.operation,
      p_source_id: ["out","transfer","adjustment"].includes(v.operation) ? v.sourceId : null,
      p_expected_quantity: ["out","transfer","adjustment"].includes(v.operation) ? v.expectedQuantity || null : null,
      p_lot_id: ["in","edit_lot"].includes(v.operation) ? v.lotId : null,
      p_location_id: hasDestination && v.destination === "location" ? v.locationId : null,
      p_container_id: hasDestination && v.destination === "container" ? v.containerId : null,
      p_quantity: v.operation === "edit_lot" ? "0" : v.quantity, p_notes: v.notes,
      p_lot_code: ["new_lot","edit_lot"].includes(v.operation) ? v.lotCode : null,
      p_expiration_date: ["new_lot","edit_lot"].includes(v.operation) ? v.expirationDate || null : null
    });
    if (error) {
      if (["PGRST202","42P01","42703"].includes(error.code)) return { error: "Falta activar existencias repartidas: ejecuta supabase/upgrade-distributed-stock.sql." };
      if (error.code === "P0001") return { error: error.message };
      if (error.code === "23505") return { error: "El código del lote o el identificador de operación ya existe." };
      return { error: "No se pudo confirmar la operación. Revisa el inventario antes de repetirla.", retry: !error.code || error.code.startsWith("08") || error.code.startsWith("PGRST00") };
    }
  } catch {
    return { error: "Respuesta no confirmada. Reintenta sin cambiar los datos.", retry: true };
  }
  revalidatePath("/dashboard", "layout");
  return { success: "Existencias actualizadas. El traslado no cambia el stock total." };
}
