"use server";

import { requireAccess } from "@/lib/auth/context";
import { readAllRows } from "@/lib/read-all";
import { categoryOptions, type InventoryCategory } from "@/lib/inventory/categories";
import type { InventoryTemplateDefinition, TemplateFieldType } from "@/lib/inventory/templates";

export async function loadCreateItemOptions() {
  const { supabase, isAdmin, roleCode, profile } = await requireAccess();
  if (!["admin", "editor", "operator"].includes(roleCode)) throw Error("No tienes permiso para crear artículos.");
  type Place = { id: string; name: string; code: string | null; headquarters_id: string; parent_location_id?: string | null };
  type Template = { id: string; code: string; name: string; description: string | null; category_code: string;
    inventory_template_fields: Array<{ is_required: boolean; sort_order: number; allowed_options: string[] | null;
      inventory_fields: { field_key: string; label: string; field_type: TemplateFieldType; options: string[] } | null }> };
  const destinations = (table: "locations" | "inventory_containers") => readAllRows((from, to) => {
    const query = supabase.from(table).select(`id, name, code, headquarters_id${table === "locations" ? ", parent_location_id" : ""}`)
      .eq("is_active", true).order("name").order("id").range(from, to);
    if (!isAdmin) query.eq("headquarters_id", profile.headquarters_id);
    return query.returns<Place[]>();
  });
  const [headquarters, locations, containers, rows, categories] = await Promise.all([
    readAllRows((from, to) => {
      const query = supabase.from("headquarters").select("id, name").eq("is_active", true).order("name").order("id").range(from, to);
      if (!isAdmin) query.eq("id", profile.headquarters_id);
      return query.returns<Array<{ id: string; name: string }>>();
    }),
    destinations("locations"), destinations("inventory_containers"),
    readAllRows((from, to) => supabase.from("inventory_templates")
      .select("id, code, name, description, category_code, inventory_template_fields(is_required, sort_order, allowed_options, inventory_fields(field_key, label, field_type, options))")
      .order("name").order("id").range(from, to).returns<Template[]>()),
    readAllRows((from, to) => supabase.from("inventory_categories").select("code, name, parent_code").order("name").order("code").range(from, to).returns<InventoryCategory[]>())
  ]);
  const categoryNames = new Map(categoryOptions(categories).map(category => [category.code, category.name]));
  const templates: InventoryTemplateDefinition[] = rows.map(template => ({
    id: template.id, code: template.code, name: template.name, description: template.description ?? "",
    category: template.category_code, categoryName: categoryNames.get(template.category_code) ?? template.category_code,
    fields: template.inventory_template_fields.sort((a, b) => a.sort_order - b.sort_order).flatMap(assignment => {
      const field = assignment.inventory_fields;
      return field ? [{ key: field.field_key, label: field.label, type: field.field_type, required: assignment.is_required,
        options: (field.options ?? []).filter(option => !assignment.allowed_options || assignment.allowed_options.includes(option)) }] : [];
    })
  }));
  const byId = new Map(locations.map(location => [location.id, location]));
  return { canChooseHeadquarters: isAdmin, userHeadquartersId: profile.headquarters_id, headquarters, templates,
    containers: containers.map(place => ({ ...place, name: place.code ? `${place.name} · ${place.code}` : place.name })),
    locations: locations.map(place => {
      const path: string[] = []; const visited = new Set<string>(); let cursor: Place | undefined = place;
      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id); path.unshift(cursor.code ? `${cursor.name} · ${cursor.code}` : cursor.name);
        cursor = cursor.parent_location_id ? byId.get(cursor.parent_location_id) : undefined;
      }
      return { ...place, name: path.join(" / ") };
    })
  };
}

export async function loadOwnAlertOptions() {
  const { supabase, isAdmin, user } = await requireAccess();
  if (!isAdmin) throw Error("Solo un administrador puede configurar avisos.");
  const { data, error } = await supabase.from("notification_preferences")
    .select("notification_email, expiry_warning_days, email_notifications_enabled").eq("profile_id", user.id)
    .maybeSingle<{ notification_email: string; expiry_warning_days: number; email_notifications_enabled: boolean }>();
  if (error) throw Error("No se pudieron cargar los avisos.");
  return { notificationEmail: data?.notification_email ?? user.email ?? "", expiryWarningDays: data?.expiry_warning_days ?? 14, emailEnabled: data?.email_notifications_enabled ?? true };
}
