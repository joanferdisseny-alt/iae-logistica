"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/context";

export type OperationState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  retrySameRequest?: boolean;
};

const uuid = z.string().uuid("Identificador UUID no válido.");
// Keep decimal strings intact: PostgreSQL numeric, not JS floating point, does the arithmetic.
const decimal = z.string().trim().max(100)
  .regex(/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/, "Introduce una cantidad decimal no negativa.")
  .transform((value) => {
    const [whole, fraction = ""] = value.replace(",", ".").split(".");
    const integer = whole.replace(/^0+/, "") || "0";
    const decimals = fraction.replace(/0+$/, "");
    return decimals ? `${integer}.${decimals}` : integer;
  })
  .refine((value) => {
    const [whole, fraction = ""] = value.split(".");
    return whole.length <= 11 && fraction.length <= 3;
  }, "Máximo 99999999999,999 y 3 decimales, sin redondeo.");
const notes = z.string().trim().min(3, "El motivo es obligatorio (mínimo 3 caracteres).").max(2000, "Máximo 2000 caracteres.");
const optionalDate = z.string().refine((value) => {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Introduce una fecha válida.").transform((value) => value || null);
const movementSchema = z.object({
  itemId: uuid,
  type: z.enum(["in", "out", "adjustment"]),
  quantity: decimal,
  notes,
  requestId: uuid
}).refine((value) => value.type === "adjustment" || /[1-9]/.test(value.quantity), {
  path: ["quantity"], message: "Las entradas y salidas deben ser mayores que cero."
});
const itemSchema = z.object({
  itemId: uuid,
  name: z.string().trim().min(2, "El nombre necesita al menos 2 caracteres.").max(200),
  description: z.string().trim().max(5000).transform((value) => value || null),
  status: z.enum(["available", "in_use", "repair", "inspection", "retired"]),
  maintenanceDueAt: optionalDate,
  expirationDate: optionalDate,
  minimumStock: z.union([z.literal(""), decimal]).transform((value) => value || null),
  notes
});
const attachmentSchema = z.object({
  itemId: uuid,
  title: z.string().trim().min(1, "El título es obligatorio.").max(200),
  url: z.string().trim().max(2048).url("Introduce una URL absoluta válida.").refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Solo se permiten enlaces HTTPS sin credenciales.")
});

function fields(form: FormData, names: string[]) {
  return Object.fromEntries(names.map((name) => [name, form.get(name) ?? ""]));
}

function invalid(error: z.ZodError): OperationState {
  return { error: "Revisa los campos indicados.", fieldErrors: error.flatten().fieldErrors };
}

async function requireAdminItem(itemId: string) {
  const context = await requireAccess();
  if (!context.isAdmin) return { error: "Solo administración puede realizar esta operación." } as const;
  const { data, error } = await context.supabase.from("inventory_items")
    .select("id").eq("id", itemId).maybeSingle<{ id: string }>();
  if (error) return { error: "No se ha podido comprobar el artículo. Vuelve a intentarlo." } as const;
  if (!data) return { error: "El artículo no existe o no tienes acceso." } as const;
  return { context } as const;
}

function refreshItem(itemId: string) {
  revalidatePath(`/dashboard/inventory/${itemId}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
}

function databaseError(error: { code?: string; message: string }): OperationState {
  if (/insufficient|stock insuficiente|stock negativo|negative stock/i.test(error.message)) {
    return { error: "Stock insuficiente. Consulta el saldo actual y revisa la cantidad." };
  }
  if (error.code === "42501") return { error: "No tienes permisos para realizar esta operación." };
  if (error.code === "23505" || /idempot|request_id|request id|identificador reutilizado/i.test(error.message)) {
    return { error: "El identificador ya se utilizó. Revisa el historial antes de registrar otro movimiento." };
  }
  if (["42883", "42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")) {
    return { error: "La operación no está disponible. Falta aplicar o actualizar el contrato SQL." };
  }
  if (error.code === "22003") return { error: "El saldo resultante supera el máximo permitido. Revisa la cantidad." };
  return { error: "No se pudo guardar. Revisa los datos y los permisos o inténtalo de nuevo." };
}

export async function recordMovement(
  _previous: OperationState | undefined,
  formData: FormData
): Promise<OperationState> {
  const parsed = movementSchema.safeParse(fields(formData, ["itemId", "type", "quantity", "notes", "requestId"]));
  if (!parsed.success) return invalid(parsed.error);
  const access = await requireAdminItem(parsed.data.itemId);
  if (access.error) return { error: access.error };
  const { itemId, type, quantity, notes: reason, requestId } = parsed.data;
  try {
    const { error } = await access.context.supabase.rpc("record_inventory_movement", {
      p_item_id: itemId, p_type: type, p_quantity: quantity, p_notes: reason, p_request_id: requestId
    });
    // A transport failure may arrive as a PostgREST error rather than a thrown exception.
    if (error) return {
      ...databaseError(error),
      retrySameRequest: !error.code || error.code.startsWith("08") || error.code.startsWith("PGRST00")
    };
  } catch {
    return { error: "No se pudo confirmar el resultado. Reintenta sin cambiar los datos: no se duplicará el movimiento.", retrySameRequest: true };
  }
  refreshItem(itemId);
  revalidatePath("/dashboard/locations", "layout");
  return { success: "Movimiento registrado. Stock actualizado." };
}

export async function updateItem(
  _previous: OperationState | undefined,
  formData: FormData
): Promise<OperationState> {
  const parsed = itemSchema.safeParse(fields(formData, ["itemId", "name", "description", "status", "maintenanceDueAt", "expirationDate", "minimumStock", "notes"]));
  if (!parsed.success) return invalid(parsed.error);
  const access = await requireAdminItem(parsed.data.itemId);
  if (access.error) return { error: access.error };
  const item = parsed.data;
  try {
    const { error } = await access.context.supabase.rpc("update_inventory_item", {
      p_item_id: item.itemId,
      p_name: item.name,
      p_description: item.description,
      p_status: item.status,
      p_maintenance_due_at: item.maintenanceDueAt,
      p_expiration_date: item.expirationDate,
      p_minimum_stock: item.minimumStock,
      p_notes: item.notes
    });
    if (error) return databaseError(error);
  } catch {
    return { error: "No se pudo confirmar el guardado. Comprueba la ficha antes de repetirlo." };
  }
  refreshItem(item.itemId);
  return { success: "Ficha y mantenimiento actualizados." };
}

export async function addAttachment(
  _previous: OperationState | undefined,
  formData: FormData
): Promise<OperationState> {
  const parsed = attachmentSchema.safeParse(fields(formData, ["itemId", "title", "url"]));
  if (!parsed.success) return invalid(parsed.error);
  const access = await requireAdminItem(parsed.data.itemId);
  if (access.error) return { error: access.error };
  try {
    const { error } = await access.context.supabase.from("inventory_attachments").insert({
      item_id: parsed.data.itemId,
      title: parsed.data.title,
      url: new URL(parsed.data.url).href,
      created_by: access.context.user.id
    });
    if (error) return databaseError(error);
  } catch {
    return { error: "No se pudo confirmar el enlace. Comprueba la lista antes de repetirlo." };
  }
  refreshItem(parsed.data.itemId);
  return { success: "Enlace añadido." };
}
