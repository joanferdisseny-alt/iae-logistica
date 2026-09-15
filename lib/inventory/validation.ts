type Assignment = {
  is_required: boolean;
  inventory_fields: { field_key: string; field_type: string; options: string[] } | null;
};

export function validateTemplateValues(fields: Assignment[], values: Record<string, string>): string | null {
  const allowed = new Set(fields.flatMap(f => f.inventory_fields ? [f.inventory_fields.field_key] : []));
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) return `El campo ${key} no pertenece a esta ficha.`;
    if (typeof values[key] !== "string" || values[key].length > 10000) return `Valor inválido: ${key}.`;
  }
  for (const assignment of fields) {
    const field = assignment.inventory_fields;
    if (!field) continue;
    const value = values[field.field_key];
    if (!value) {
      if (assignment.is_required && field.field_type !== "boolean") return `Completa el campo ${field.field_key}.`;
      continue;
    }
    if (field.field_type === "number" && !Number.isFinite(Number(value))) return `Número inválido: ${field.field_key}.`;
    if (field.field_type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return `Fecha inválida: ${field.field_key}.`;
    if (field.field_type === "select" && !field.options.includes(value)) return `Opción inválida: ${field.field_key}.`;
    if (field.field_type === "boolean" && !["true", "false"].includes(value)) return `Valor booleano inválido: ${field.field_key}.`;
    if (["current_stock", "minimum_stock"].includes(field.field_key) && (!Number.isFinite(Number(value)) || Number(value) < 0 || !/^\d+(\.\d{1,3})?$/.test(value))) return `Cantidad inválida: ${field.field_key}. Usa hasta tres decimales.`;
  }
  return null;
}
