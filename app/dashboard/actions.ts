"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAccess } from "@/lib/auth/context";
import { validateTemplateValues } from "@/lib/inventory/validation";

async function checkedMutation(query: PromiseLike<{ error: { message: string } | null }>) {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
}

type ActionState = {
  error?: string;
  success?: string;
};

const createUserSchema = z.object({
  email: z.string().email("Introduce un email válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
  fullName: z.string().min(2, "Indica el nombre del usuario."),
  roleCode: z.enum(["admin", "editor", "reader", "operator", "viewer"]),
  headquartersId: z.string().uuid().optional().or(z.literal(""))
});

const updateRoleSchema = z.object({
  profileId: z.string().uuid(),
  roleCode: z.enum(["admin", "editor", "reader", "operator", "viewer"]),
  isActive: z.enum(["true", "false"]),
  headquartersId: z.string().uuid().optional().or(z.literal(""))
});

const createInventoryItemSchema = z.object({
  templateCode: z.string().min(1, "Selecciona un tipo de ficha."),
  category: z.string().min(1, "Selecciona una categoría."),
  technicalSpecs: z.string().optional(),
  headquartersId: z.string().uuid().optional().or(z.literal("")),
  placementType: z.enum(["none", "location", "container"]).default("none"),
  locationId: z.string().uuid().optional().or(z.literal("")),
  containerId: z.string().uuid().optional().or(z.literal("")),
  containerQuantity: z.coerce.number().positive().max(99999999999).default(1),
  containerNotes: z.string().optional()
});

const addInventoryRelationSchema = z.object({
  sourceItemId: z.string().uuid(),
  targetItemId: z.string().uuid(),
  relationType: z.enum(["uses", "requires", "compatible_with"]),
  quantityRequired: z.coerce.number().int().min(1).max(999),
  notes: z.string().optional()
});

const createInventoryCategorySchema = z.object({
  code: z
    .string()
    .min(2, "El código es obligatorio.")
    .regex(/^[a-z0-9_]+$/, "Usa minúsculas, números y guiones bajos."),
  name: z.string().min(2, "El nombre es obligatorio."),
  description: z.string().optional()
});

const createInventoryTemplateSchema = z.object({
  code: z
    .string()
    .min(2, "El código es obligatorio.")
    .regex(/^[a-z0-9_]+$/, "Usa minúsculas, números y guiones bajos."),
  name: z.string().min(2, "El nombre es obligatorio."),
  categoryCode: z.string().min(1, "Selecciona una categoría."),
  description: z.string().optional()
});

const createInventoryTemplateFieldSchema = z.object({
  fieldKey: z
    .string()
    .min(2, "La clave es obligatoria.")
    .regex(/^[a-z0-9_]+$/, "Usa minúsculas, números y guiones bajos."),
  label: z.string().min(2, "La etiqueta es obligatoria."),
  fieldType: z.enum(["text", "number", "date", "textarea", "select", "boolean"]),
  options: z.string().optional(),
  isRequired: z.enum(["true", "false"]).default("false")
});

const updateInventoryCategorySchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2, "El nombre es obligatorio."),
  description: z.string().optional()
});

const deleteInventoryCategorySchema = z.object({
  code: z.string().min(2)
});

const updateInventoryTemplateSchema = z.object({
  id: z.string().uuid(),
  code: z
    .string()
    .min(2, "El código es obligatorio.")
    .regex(/^[a-z0-9_]+$/, "Usa minúsculas, números y guiones bajos."),
  name: z.string().min(2, "El nombre es obligatorio."),
  categoryCode: z.string().min(1, "Selecciona una categoría."),
  description: z.string().optional()
});

const deleteInventoryTemplateSchema = z.object({
  id: z.string().uuid()
});

const updateInventoryTemplateFieldSchema = z.object({
  id: z.string().uuid(),
  fieldKey: z
    .string()
    .min(2, "La clave es obligatoria.")
    .regex(/^[a-z0-9_]+$/, "Usa minúsculas, números y guiones bajos."),
  label: z.string().min(2, "La etiqueta es obligatoria."),
  fieldType: z.enum(["text", "number", "date", "textarea", "select", "boolean"]),
  options: z.string().optional(),
});

const deleteInventoryTemplateFieldSchema = z.object({
  id: z.string().uuid()
});

const addFieldToTemplateSchema = z.object({
  templateId: z.string().uuid(),
  fieldId: z.string().uuid(),
  isRequired: z.enum(["true", "false"]).default("false")
});

const removeFieldFromTemplateSchema = z.object({
  assignmentId: z.string().uuid()
});

const notificationPreferencesSchema = z.object({
  notificationEmail: z.string().email("Introduce un email válido."),
  expiryWarningDays: z.coerce
    .number()
    .int()
    .min(1, "Indica al menos 1 día de antelación.")
    .max(365, "El máximo es 365 días."),
  emailEnabled: z.enum(["true", "false"]).default("false")
});

const headquartersSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "El nombre de la sede es obligatorio."),
  slug: z
    .string()
    .optional()
    .transform((value) => (value ?? "").trim()),
  address: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  country: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional()
});

const deleteHeadquartersSchema = z.object({
  id: z.string().uuid()
});

const createStorageLocationSchema = z.object({
  headquartersId: z.string().uuid().optional().or(z.literal("")),
  parentLocationId: z.string().uuid().optional().or(z.literal("")),
  name: z.string().min(2, "El nombre de la ubicación es obligatorio."),
  code: z.string().optional(),
  locationType: z.enum(["room", "cabinet", "shelf", "rack", "vehicle", "storage", "other"]),
  description: z.string().optional()
});

const updateStorageLocationSchema = createStorageLocationSchema.extend({
  id: z.string().uuid()
});

const deleteStorageLocationSchema = z.object({
  id: z.string().uuid()
});

const createInventoryContainerSchema = z.object({
  headquartersId: z.string().uuid().optional().or(z.literal("")),
  locationId: z.string().uuid().optional().or(z.literal("")),
  name: z.string().min(2, "El nombre de la caja es obligatorio."),
  code: z.string().optional(),
  containerType: z.enum(["intervention", "practice", "storage", "transport"]),
  description: z.string().optional()
});

const updateInventoryContainerSchema = createInventoryContainerSchema.extend({
  id: z.string().uuid()
});

const deleteInventoryContainerSchema = z.object({
  id: z.string().uuid()
});

const assignItemPlacementSchema = z.object({
  itemId: z.string().uuid(),
  placementType: z.enum(["location", "container", "none"]),
  locationId: z.string().uuid().optional().or(z.literal("")),
  containerId: z.string().uuid().optional().or(z.literal("")),
  quantity: z.coerce.number().positive().max(99999999999).default(1),
  notes: z.string().optional()
});

async function requireAdmin() {
  const context = await requireAccess();
  if (!context.isAdmin) throw new Error("Forbidden");
  return { supabase: context.supabase, userId: context.user.id };
}

async function requireInventoryManager() {
  const context = await requireAccess();
  if (!["admin", "editor", "operator"].includes(context.roleCode)) throw new Error("Forbidden");
  return { supabase: context.supabase, userId: context.user.id, roleCode: context.roleCode, headquartersId: context.profile.headquarters_id };
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseOptionalInt(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseOptionalDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function createUser(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "No tienes permisos para crear usuarios." };
  }

  const parsed = createUserSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    fullName: String(formData.get("fullName") ?? "").trim(),
    roleCode: String(formData.get("roleCode") ?? "reader"),
    headquartersId: String(formData.get("headquartersId") ?? "")
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const headquartersId =
    parsed.data.roleCode === "admin" ? null : parsed.data.headquartersId || null;

  if (parsed.data.roleCode !== "admin" && !headquartersId) {
    return { error: "Asigna una sede a los usuarios que no sean administradores." };
  }

  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullName
    }
  });

  if (error || !data.user) {
    return { error: "No se ha podido crear el usuario." };
  }

  const { data: role } = await admin
    .from("app_roles")
    .select("id")
    .eq("code", parsed.data.roleCode)
    .maybeSingle<{ id: string }>();

  if (!role) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: "No se ha encontrado el rol solicitado. Alta cancelada." };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      is_logistics_contact: formData.get("isLogisticsContact") === "on",
      role_id: role.id,
      headquarters_id: headquartersId
    })
    .eq("id", data.user.id);

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: "No se pudo asignar el rol. El alta se ha cancelado." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/users");
  return { success: "Usuario creado correctamente." };
}

export async function updateUserAccess(formData: FormData) {
  try {
  let actorId = "";

  try {
    const adminContext = await requireAdmin();
    actorId = adminContext.userId;
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = updateRoleSchema.safeParse({
    profileId: String(formData.get("profileId") ?? ""),
    roleCode: String(formData.get("roleCode") ?? "reader"),
    isActive: String(formData.get("isActive") ?? "true"),
    headquartersId: String(formData.get("headquartersId") ?? "")
  });

  if (!parsed.success) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  if (parsed.data.profileId === actorId && parsed.data.isActive === "false") {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const supabase = await createClient();

  const { data: role } = await supabase
    .from("app_roles")
    .select("id")
    .eq("code", parsed.data.roleCode)
    .maybeSingle<{ id: string }>();

  if (!role) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const headquartersId =
    parsed.data.roleCode === "admin" ? null : parsed.data.headquartersId || null;

  if (parsed.data.roleCode !== "admin" && !headquartersId) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  await checkedMutation(supabase.from("profiles")
    .update({
      role_id: role.id,
      ...(formData.has("isLogisticsContact") ? { is_logistics_contact: formData.get("isLogisticsContact") === "true" } : {}),
      is_active: parsed.data.isActive === "true",
      headquarters_id: headquartersId
    })
    .eq("id", parsed.data.profileId));

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/users");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}

export async function createInventoryItem(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  let managerContext;

  try {
    managerContext = await requireInventoryManager();
  } catch {
    return { error: "No tienes permisos para crear artículos." };
  }

  const parsed = createInventoryItemSchema.safeParse({
    templateCode: String(formData.get("templateCode") ?? "").trim(),
    category: String(formData.get("category") ?? "material"),
    technicalSpecs:
      String(formData.get("technicalSpecs") ?? "").trim() || undefined,
    headquartersId: String(formData.get("headquartersId") ?? ""),
    placementType: String(formData.get("placementType") ?? "none"),
    locationId: String(formData.get("locationId") ?? ""),
    containerId: String(formData.get("containerId") ?? ""),
    containerQuantity: Number(formData.get("containerQuantity") ?? 1),
    containerNotes: String(formData.get("containerNotes") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  let technicalSpecs: Record<string, string> = {};
  const receivingId = String(formData.get("receivingId") ?? "");
  if (receivingId && !z.string().uuid().safeParse(receivingId).success) return { error: "Identificador de alta no válido." };
  const { data: templateRow } = await managerContext.supabase
    .from("inventory_templates")
    .select("id, code, category_code, inventory_template_fields(is_required, inventory_fields(field_key, field_type, options))")
    .eq("code", parsed.data.templateCode)
    .maybeSingle<{ id: string; code: string; category_code: string; inventory_template_fields: Array<{ is_required: boolean; inventory_fields: { field_key: string; field_type: string; options: string[] } | null }> }>();

  if (!templateRow) {
    return { error: "La ficha seleccionada no existe." };
  }

  const headquartersId =
    managerContext.roleCode === "admin"
      ? parsed.data.headquartersId || null
      : managerContext.headquartersId;

  if (!headquartersId) {
    return { error: "Selecciona una sede para poder crear el artículo." };
  }

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("templateField_")) {
      continue;
    }

    const fieldKey = key.replace("templateField_", "");
    const fieldValue = String(value).trim();

    if (fieldValue) {
      technicalSpecs[fieldKey] = fieldValue;
    }
  }

  if (parsed.data.technicalSpecs) {
    try {
      technicalSpecs = {
        ...technicalSpecs,
        ...(JSON.parse(parsed.data.technicalSpecs) as Record<string, string>)
      };
    } catch {
      return {
        error: "Las especificaciones técnicas deben estar en formato JSON válido."
      };
    }
  }

  const validation = validateTemplateValues(templateRow.inventory_template_fields, technicalSpecs);
  if (validation) return { error: validation };
  const itemName =
    technicalSpecs.item_name ||
    technicalSpecs.name ||
    `${templateRow.code}-${receivingId || Date.now().toString().slice(-6)}`;
  const subtype = technicalSpecs.subtype || null;
  const description = technicalSpecs.description || null;
  const sku = technicalSpecs.sku || null;
  const serialNumber = technicalSpecs.serial_number || null;
  const unit = technicalSpecs.unit || null;
  const currentStock = receivingId ? 0 : parseOptionalInt(technicalSpecs.current_stock) ?? 0;
  const minimumStock = parseOptionalInt(technicalSpecs.minimum_stock);
  const expirationDate = parseOptionalDate(technicalSpecs.expiration_date);
  const maintenanceDueAt = parseOptionalDate(technicalSpecs.maintenance_due_at);
  const locationId = parsed.data.placementType === "location" && parsed.data.locationId
    ? parsed.data.locationId
    : parsed.data.placementType === "none" && technicalSpecs.location_id &&
        z.string().uuid().safeParse(technicalSpecs.location_id).success
      ? technicalSpecs.location_id
      : null;

  if (parsed.data.placementType === "location" && !parsed.data.locationId) {
    return { error: "Selecciona una ubicación física." };
  }

  if (parsed.data.placementType === "container" && !parsed.data.containerId) {
    return { error: "Selecciona una caja." };
  }

  const reservedFieldKeys = new Set([
    "item_name",
    "name",
    "subtype",
    "description",
    "sku",
    "serial_number",
    "unit",
    "current_stock",
    "minimum_stock",
    "expiration_date",
    "maintenance_due_at",
    "location_id"
  ]);

  const filteredTechnicalSpecs = Object.fromEntries(
    Object.entries(technicalSpecs).filter(([key]) => !reservedFieldKeys.has(key))
  );

  const baseSlug = slugify(itemName);
  const slug = `${baseSlug || "item"}-${receivingId || crypto.randomUUID()}`;
  const status =
    minimumStock !== null &&
    currentStock <= minimumStock
      ? "low"
      : "ok";

  const record = {
    name: itemName,
    slug,
    template_id: templateRow.id,
    category: templateRow.category_code,
    subtype,
    description,
    technical_specs: filteredTechnicalSpecs,
    sku,
    serial_number: serialNumber,
    location_id: locationId,
    is_consumable: technicalSpecs.is_consumable === "true" || ["food", "consumable"].includes(templateRow.category_code),
    lot_code: technicalSpecs.lot_code || null,
    minimum_stock: minimumStock,
    current_stock: currentStock,
    unit,
    expiration_date: expirationDate,
    maintenance_due_at: maintenanceDueAt,
    status,
    created_by: managerContext.userId,
    headquarters_id: headquartersId
  };
  const { data: insertedItem, error } = receivingId
    ? await managerContext.supabase.rpc("create_inventory_record_once", { p_id: receivingId, p_record: record })
    : await managerContext.supabase.rpc("create_inventory_record", { p_record: record,
      p_container_id: parsed.data.placementType === "container" ? parsed.data.containerId || null : null,
      p_quantity: currentStock, p_notes: parsed.data.containerNotes || null });

  if (error || !insertedItem) {
    return { error: "No se ha podido crear el artículo: " + (error?.message ?? "Sin respuesta"), retry: !!receivingId && (!error?.code || error.code.startsWith("08") || error.code.startsWith("PGRST00")) };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/locations");
  return { success: "Artículo creado correctamente.", itemId: String(insertedItem), itemName };
}

export async function createHeadquarters(
  _previousState: ActionState | undefined,
  formData: FormData
) {

  try {
    await requireAdmin();
  } catch {
    return { error: "No tienes permisos para crear sedes." };
  }

  const parsed = headquartersSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim() || undefined,
    city: String(formData.get("city") ?? "").trim() || undefined,
    province: String(formData.get("province") ?? "").trim() || undefined,
    country: String(formData.get("country") ?? "").trim() || "España"
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const slug = slugify(parsed.data.slug || parsed.data.name);
  const admin = await createClient();

  const { data: existingHeadquarters } = await admin
    .from("headquarters")
    .select("id, name, is_active")
    .eq("slug", slug)
    .maybeSingle<{ id: string; name: string; is_active: boolean }>();

  if (existingHeadquarters) {
    return {
      error: existingHeadquarters.is_active
        ? `La sede "${existingHeadquarters.name}" ya existe. Usa Editar si quieres cambiar sus datos.`
        : `La sede "${existingHeadquarters.name}" existe pero está inactiva. Edítala para reactivarla.`
    };
  }

  const { error } = await admin.from("headquarters").insert({
    name: parsed.data.name,
    slug,
    address: parsed.data.address ?? null,
    city: parsed.data.city ?? null,
    province: parsed.data.province ?? null,
    country: parsed.data.country ?? "España",
    is_active: true
  });

  if (error) {
    return { error: "No se ha podido crear la sede. Revisa los datos e inténtalo de nuevo." };
  }

  revalidatePath("/dashboard/headquarters");
  revalidatePath("/dashboard/users");
  return { success: "Sede creada correctamente." };
}

export async function createStorageLocation(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "Solo un administrador puede crear ubicaciones." };
  }

  const parsed = createStorageLocationSchema.safeParse({
    headquartersId: String(formData.get("headquartersId") ?? ""),
    parentLocationId: String(formData.get("parentLocationId") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim() || undefined,
    locationType: String(formData.get("locationType") ?? "storage"),
    description: String(formData.get("description") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const headquartersId = parsed.data.headquartersId || null;

  if (!headquartersId) {
    return { error: "Selecciona una sede para crear la ubicación." };
  }

  const admin = await createClient();

  const { error } = await admin.from("locations").insert({
    name: parsed.data.name,
    code: parsed.data.code ?? null,
    headquarters_id: headquartersId,
    parent_location_id: parsed.data.parentLocationId || null,
    location_type: parsed.data.locationType,
    description: parsed.data.description ?? null,
    is_active: true
  });

  if (error) {
    return { error: `No se ha podido crear la ubicación: ${error.message}` };
  }

  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard/inventory");
  return { success: "Ubicación creada correctamente." };
}

export async function updateStorageLocation(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "Solo un administrador puede editar ubicaciones." };
  }

  const parsed = updateStorageLocationSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    headquartersId: String(formData.get("headquartersId") ?? ""),
    parentLocationId: String(formData.get("parentLocationId") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim() || undefined,
    locationType: String(formData.get("locationType") ?? "storage"),
    description: String(formData.get("description") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const headquartersId = parsed.data.headquartersId || null;

  if (!headquartersId) {
    return { error: "Selecciona una sede para guardar la ubicación." };
  }

  if (parsed.data.parentLocationId === parsed.data.id) {
    return { error: "Una ubicación no puede estar dentro de sí misma." };
  }

  const admin = await createClient();

  const { error } = await admin
    .from("locations")
    .update({
      name: parsed.data.name,
      code: parsed.data.code ?? null,
      headquarters_id: headquartersId,
      parent_location_id: parsed.data.parentLocationId || null,
      location_type: parsed.data.locationType,
      description: parsed.data.description ?? null
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { error: `No se ha podido actualizar la ubicación: ${error.message}` };
  }

  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard/inventory");
  return { success: "Ubicación actualizada correctamente." };
}

export async function deleteStorageLocation(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "Solo un administrador puede borrar ubicaciones." };
  }

  const parsed = deleteStorageLocationSchema.safeParse({
    id: String(formData.get("id") ?? "")
  });

  if (!parsed.success) {
    return { error: "Ubicación inválida." };
  }

  const admin = await createClient();
  const [
    { count: childCount },
    { count: itemCount },
    { count: containerCount }
  ] = await Promise.all([
    admin
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("parent_location_id", parsed.data.id),
    admin
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("location_id", parsed.data.id),
    admin
      .from("inventory_containers")
      .select("id", { count: "exact", head: true })
      .eq("location_id", parsed.data.id)
  ]);

  if ((childCount ?? 0) > 0 || (itemCount ?? 0) > 0 || (containerCount ?? 0) > 0) {
    return {
      error:
        "No se puede borrar esta ubicación porque tiene sububicaciones, artículos o cajas asignadas. Muévelos primero."
    };
  }

  const { error } = await admin.from("locations").delete().eq("id", parsed.data.id);

  if (error) {
    return { error: `No se ha podido borrar la ubicación: ${error.message}` };
  }

  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard/inventory");
  return { success: "Ubicación borrada correctamente." };
}

export async function createInventoryContainer(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "Solo un administrador puede crear cajas." };
  }

  const parsed = createInventoryContainerSchema.safeParse({
    headquartersId: String(formData.get("headquartersId") ?? ""),
    locationId: String(formData.get("locationId") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim() || undefined,
    containerType: String(formData.get("containerType") ?? "intervention"),
    description: String(formData.get("description") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const headquartersId = parsed.data.headquartersId || null;

  if (!headquartersId) {
    return { error: "Selecciona una sede para crear la caja." };
  }

  const admin = await createClient();

  const { error } = await admin.from("inventory_containers").insert({
    name: parsed.data.name,
    code: parsed.data.code ?? null,
    container_type: parsed.data.containerType,
    headquarters_id: headquartersId,
    location_id: parsed.data.locationId || null,
    description: parsed.data.description ?? null,
    is_active: true
  });

  if (error) {
    return { error: `No se ha podido crear la caja: ${error.message}` };
  }

  revalidatePath("/dashboard/locations");
  return { success: "Caja creada correctamente." };
}

export async function updateInventoryContainer(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "Solo un administrador puede editar cajas." };
  }

  const parsed = updateInventoryContainerSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    headquartersId: String(formData.get("headquartersId") ?? ""),
    locationId: String(formData.get("locationId") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim() || undefined,
    containerType: String(formData.get("containerType") ?? "intervention"),
    description: String(formData.get("description") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const headquartersId = parsed.data.headquartersId || null;

  if (!headquartersId) {
    return { error: "Selecciona una sede para guardar la caja." };
  }

  const admin = await createClient();

  const { error } = await admin
    .from("inventory_containers")
    .update({
      name: parsed.data.name,
      code: parsed.data.code ?? null,
      container_type: parsed.data.containerType,
      headquarters_id: headquartersId,
      location_id: parsed.data.locationId || null,
      description: parsed.data.description ?? null
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { error: `No se ha podido actualizar la caja: ${error.message}` };
  }

  revalidatePath("/dashboard/locations");
  revalidatePath(`/dashboard/locations/containers/${parsed.data.id}`);
  revalidatePath("/dashboard/inventory");
  return { success: "Caja actualizada correctamente." };
}

export async function deleteInventoryContainer(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "Solo un administrador puede borrar cajas." };
  }

  const parsed = deleteInventoryContainerSchema.safeParse({
    id: String(formData.get("id") ?? "")
  });

  if (!parsed.success) {
    return { error: "Caja inválida." };
  }

  const admin = await createClient();
  const { count } = await admin
    .from("inventory_container_items")
    .select("item_id", { count: "exact", head: true })
    .eq("container_id", parsed.data.id);

  if ((count ?? 0) > 0) {
    return {
      error: "No se puede borrar esta caja porque contiene artículos. Sácalos o reubícalos primero."
    };
  }

  const { error } = await admin.from("inventory_containers").delete().eq("id", parsed.data.id);

  if (error) {
    return { error: `No se ha podido borrar la caja: ${error.message}` };
  }

  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard/inventory");
  return { success: "Caja borrada correctamente." };
}

export async function addItemToContainer(_previousState: ActionState | undefined, formData: FormData) {
  const placement = new FormData();
  placement.set("itemId", String(formData.get("itemId") ?? ""));
  placement.set("placementType", "container");
  placement.set("containerId", String(formData.get("containerId") ?? ""));
  placement.set("quantity", String(formData.get("quantity") ?? 1));
  placement.set("notes", String(formData.get("notes") ?? ""));
  return assignItemPlacement(undefined, placement);
}

export async function assignItemPlacement(_previousState: ActionState | undefined, formData: FormData) {
  let context;
  try { context = await requireAdmin(); }
  catch { return { error: "Solo administradores pueden cambiar la ubicación." }; }
  const parsed = assignItemPlacementSchema.safeParse({
    itemId: String(formData.get("itemId") ?? ""),
    placementType: String(formData.get("placementType") ?? "none"),
    locationId: String(formData.get("locationId") ?? ""),
    containerId: String(formData.get("containerId") ?? ""),
    quantity: Number(formData.get("quantity") ?? 1),
    notes: String(formData.get("notes") ?? "").trim()
  });
  if (!parsed.success) return { error: "Revisa el destino y la cantidad." };
  const { error } = await context.supabase.rpc("place_inventory_item", {
    p_item_id: parsed.data.itemId, p_type: parsed.data.placementType,
    p_location_id: parsed.data.locationId || null, p_container_id: parsed.data.containerId || null,
    p_quantity: parsed.data.quantity, p_notes: parsed.data.notes || null
  });
  if (error) return { error: "No se ha guardado la ubicación: " + error.message };
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/locations", "layout");
  revalidatePath(`/dashboard/inventory/${parsed.data.itemId}`);
  return { success: "Ubicación guardada." };
}

export async function updateHeadquarters(formData: FormData) {
  try {

  try {
    await requireAdmin();
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = headquartersSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim() || undefined,
    city: String(formData.get("city") ?? "").trim() || undefined,
    province: String(formData.get("province") ?? "").trim() || undefined,
    country: String(formData.get("country") ?? "").trim() || "España",
    isActive: String(formData.get("isActive") ?? "true")
  });

  if (!parsed.success || !parsed.data.id) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const admin = await createClient();

  await checkedMutation(admin.from("headquarters")
    .update({
      name: parsed.data.name,
      slug: slugify(parsed.data.slug || parsed.data.name),
      address: parsed.data.address ?? null,
      city: parsed.data.city ?? null,
      province: parsed.data.province ?? null,
      country: parsed.data.country ?? "España",
      is_active: parsed.data.isActive !== "false"
    })
    .eq("id", parsed.data.id));

  revalidatePath("/dashboard/headquarters");
  revalidatePath("/dashboard/users");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}

export async function deleteHeadquarters(formData: FormData) {
  try {

  try {
    await requireAdmin();
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = deleteHeadquartersSchema.safeParse({
    id: String(formData.get("id") ?? "")
  });

  if (!parsed.success) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const admin = await createClient();

  const [{ count: userCount }, { count: itemCount }] = await Promise.all([
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("headquarters_id", parsed.data.id),
    admin
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("headquarters_id", parsed.data.id)
  ]);

  if ((userCount ?? 0) > 0 || (itemCount ?? 0) > 0) {
    await checkedMutation(admin.from("headquarters")
      .update({ is_active: false })
      .eq("id", parsed.data.id));
  } else {
    await checkedMutation(admin.from("headquarters").delete().eq("id", parsed.data.id));
  }

  revalidatePath("/dashboard/headquarters");
  revalidatePath("/dashboard/users");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}

export async function saveNotificationPreferences(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  let context;

  try {
    context = await requireAdmin();
  } catch {
    return { error: "Solo un administrador puede configurar los avisos de caducidad." };
  }

  const parsed = notificationPreferencesSchema.safeParse({
    notificationEmail: String(formData.get("notificationEmail") ?? "").trim(),
    expiryWarningDays: Number(formData.get("expiryWarningDays") ?? 14),
    emailEnabled: formData.get("emailEnabled") ? "true" : "false"
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const targetId = String(formData.get("profileId") ?? context.userId);
  if (!z.string().uuid().safeParse(targetId).success) return { error: "Destinatario inválido." };
  const { data: recipient, error: recipientError } = await context.supabase.from("profiles").select("id, is_active").eq("id", targetId).maybeSingle();
  if (recipientError || !recipient?.is_active) return { error: "El destinatario debe ser un usuario activo." };
  const { error } = await context.supabase.from("notification_preferences").upsert({
    profile_id: targetId,
    notification_email: parsed.data.notificationEmail,
    expiry_warning_days: parsed.data.expiryWarningDays,
    email_notifications_enabled: parsed.data.emailEnabled === "true"
  });

  if (error) {
    return {
      error:
        "No se ha podido guardar la configuración. Ejecuta la migración nueva de Supabase si aún no lo has hecho."
    };
  }

  revalidatePath("/dashboard/inventory");
  return { success: "Configuración de avisos actualizada." };
}

export async function addInventoryRelation(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  let managerContext;

  try {
    const adminContext = await requireAdmin();
    managerContext = adminContext;
  } catch {
    return { error: "Solo administradores pueden relacionar artículos." };
  }

  const parsed = addInventoryRelationSchema.safeParse({
    sourceItemId: String(formData.get("sourceItemId") ?? ""),
    targetItemId: String(formData.get("targetItemId") ?? ""),
    relationType: String(formData.get("relationType") ?? "uses"),
    quantityRequired: Number(formData.get("quantityRequired") ?? 1),
    notes: String(formData.get("notes") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  if (parsed.data.sourceItemId === parsed.data.targetItemId) {
    return { error: "No puedes relacionar un artículo consigo mismo." };
  }

  const { error } = await managerContext.supabase.from("inventory_item_relations").upsert(
    {
      source_item_id: parsed.data.sourceItemId,
      target_item_id: parsed.data.targetItemId,
      relation_type: parsed.data.relationType,
      quantity_required: parsed.data.quantityRequired,
      notes: parsed.data.notes ?? null
    },
    {
      onConflict: "source_item_id,target_item_id,relation_type"
    }
  );

  if (error) {
    return {
      error:
        "No se ha podido guardar la relación. Ejecuta la migración nueva de plantillas/relaciones en Supabase."
    };
  }

  revalidatePath(`/dashboard/inventory/${parsed.data.sourceItemId}`);
  return { success: "Relación guardada." };
}

export async function createInventoryCategory(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "No tienes permisos para crear categorías." };
  }

  const parsed = createInventoryCategorySchema.safeParse({
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("inventory_categories").insert({
    code: parsed.data.code,
    name: parsed.data.name,
    description: parsed.data.description ?? null
  });

  if (error) {
    return { error: "No se ha podido crear la categoría." };
  }

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/inventory");
  return { success: "Categoría creada." };
}

export async function createInventoryTemplate(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "No tienes permisos para crear fichas." };
  }

  const parsed = createInventoryTemplateSchema.safeParse({
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    categoryCode: String(formData.get("categoryCode") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("inventory_templates").insert({
    code: parsed.data.code,
    name: parsed.data.name,
    category_code: parsed.data.categoryCode,
    description: parsed.data.description ?? null
  });

  if (error) {
    return { error: "No se ha podido crear la ficha." };
  }

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/inventory");
  return { success: "Ficha creada." };
}

export async function createInventoryTemplateField(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "No tienes permisos para crear campos." };
  }

  const parsed = createInventoryTemplateFieldSchema.safeParse({
    fieldKey: String(formData.get("fieldKey") ?? "").trim(),
    label: String(formData.get("label") ?? "").trim(),
    fieldType: String(formData.get("fieldType") ?? "text"),
    options: String(formData.get("options") ?? "").trim() || undefined,
    isRequired: formData.get("isRequired") ? "true" : "false"
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  let options: string[] = [];

  if (parsed.data.options) {
    options = parsed.data.options
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("inventory_fields").insert({
    field_key: parsed.data.fieldKey,
    label: parsed.data.label,
    field_type: parsed.data.fieldType,
    options
  });

  if (error) {
    return { error: "No se ha podido crear el campo." };
  }

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/templates/fields");
  revalidatePath("/dashboard/inventory");
  return { success: "Campo creado." };
}

export async function addFieldToTemplate(
  _previousState: ActionState | undefined,
  formData: FormData
) {
  try {
    await requireAdmin();
  } catch {
    return { error: "No tienes permisos para asignar campos." };
  }

  const parsed = addFieldToTemplateSchema.safeParse({
    templateId: String(formData.get("templateId") ?? ""),
    fieldId: String(formData.get("fieldId") ?? ""),
    isRequired: formData.get("isRequired") ? "true" : "false"
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data: field } = await supabase
    .from("inventory_fields")
    .select("field_key, label, field_type, options")
    .eq("id", parsed.data.fieldId)
    .maybeSingle<{
      field_key: string;
      label: string;
      field_type: "text" | "number" | "date" | "textarea" | "select" | "boolean";
      options: string[];
    }>();

  if (!field) {
    return { error: "El campo seleccionado no existe." };
  }

  const { data: countRows } = await supabase
    .from("inventory_template_fields")
    .select("id")
    .eq("template_id", parsed.data.templateId);

  const { error } = await supabase.from("inventory_template_fields").insert({
    template_id: parsed.data.templateId,
    field_id: parsed.data.fieldId,
    field_key: field.field_key,
    label: field.label,
    field_type: field.field_type,
    options: field.options ?? [],
    is_required: parsed.data.isRequired === "true",
    sort_order: (countRows?.length ?? 0) + 1
  });

  if (error) {
    return { error: "No se ha podido añadir el campo a la ficha." };
  }

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/templates/fields");
  revalidatePath("/dashboard/inventory");
  return { success: "Campo añadido a la ficha." };
}

export async function updateInventoryCategory(formData: FormData) {
  try {
  try {
    await requireAdmin();
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = updateInventoryCategorySchema.safeParse({
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const supabase = await createClient();
  await checkedMutation(supabase.from("inventory_categories")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null
    })
    .eq("code", parsed.data.code));

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/inventory");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}

export async function deleteInventoryCategory(formData: FormData) {
  try {
  try {
    await requireAdmin();
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = deleteInventoryCategorySchema.safeParse({
    code: String(formData.get("code") ?? "").trim()
  });

  if (!parsed.success) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const supabase = await createClient();
  const [{ data: templates }, { data: items }] = await Promise.all([
    supabase
      .from("inventory_templates")
      .select("id")
      .eq("category_code", parsed.data.code),
    supabase.from("inventory_items").select("id").eq("category", parsed.data.code)
  ]);

  if ((templates?.length ?? 0) > 0 || (items?.length ?? 0) > 0) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  await checkedMutation(supabase.from("inventory_categories").delete().eq("code", parsed.data.code));

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/inventory");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}

export async function updateInventoryTemplate(formData: FormData) {
  try {
  try {
    await requireAdmin();
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = updateInventoryTemplateSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    categoryCode: String(formData.get("categoryCode") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const supabase = await createClient();
  await checkedMutation(supabase.from("inventory_templates")
    .update({
      code: parsed.data.code,
      name: parsed.data.name,
      category_code: parsed.data.categoryCode,
      description: parsed.data.description ?? null
    })
    .eq("id", parsed.data.id));

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/inventory");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}

export async function deleteInventoryTemplate(formData: FormData) {
  try {
  try {
    await requireAdmin();
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = deleteInventoryTemplateSchema.safeParse({
    id: String(formData.get("id") ?? "")
  });

  if (!parsed.success) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const supabase = await createClient();
  const { data: items } = await supabase
    .from("inventory_items")
    .select("id")
    .eq("template_id", parsed.data.id);

  if ((items?.length ?? 0) > 0) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  await checkedMutation(supabase.from("inventory_templates").delete().eq("id", parsed.data.id));

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/inventory");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}

export async function updateInventoryTemplateField(formData: FormData) {
  try {
  try {
    await requireAdmin();
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = updateInventoryTemplateFieldSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    fieldKey: String(formData.get("fieldKey") ?? "").trim(),
    label: String(formData.get("label") ?? "").trim(),
    fieldType: String(formData.get("fieldType") ?? "text"),
    options: String(formData.get("options") ?? "").trim() || undefined
  });

  if (!parsed.success) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const options = parsed.data.options
    ? parsed.data.options
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean)
    : [];

  const supabase = await createClient();
  await checkedMutation(supabase.rpc("update_catalog_field", {
    p_id: parsed.data.id, p_key: parsed.data.fieldKey,
    p_label: parsed.data.label, p_type: parsed.data.fieldType, p_options: options
  }));

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/templates/fields");
  revalidatePath("/dashboard/inventory");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}

export async function deleteInventoryTemplateField(formData: FormData) {
  try {
  try {
    await requireAdmin();
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = deleteInventoryTemplateFieldSchema.safeParse({
    id: String(formData.get("id") ?? "")
  });

  if (!parsed.success) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const supabase = await createClient();
  const { data: assignments } = await supabase
    .from("inventory_template_fields")
    .select("id")
    .eq("field_id", parsed.data.id);

  if ((assignments?.length ?? 0) > 0) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  await checkedMutation(supabase.from("inventory_fields").delete().eq("id", parsed.data.id));

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/templates/fields");
  revalidatePath("/dashboard/inventory");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}

export async function removeFieldFromTemplate(formData: FormData) {
  try {
  try {
    await requireAdmin();
  } catch {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const parsed = removeFieldFromTemplateSchema.safeParse({
    assignmentId: String(formData.get("assignmentId") ?? "")
  });

  if (!parsed.success) {
    return { error: "No se puede completar la operación. Revisa permisos, campos y elementos asociados." };
  }

  const supabase = await createClient();
  await checkedMutation(supabase.from("inventory_template_fields").delete().eq("id", parsed.data.assignmentId));

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/inventory");
  return { success: "Cambios guardados." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se han podido guardar los cambios." };
  }
}
