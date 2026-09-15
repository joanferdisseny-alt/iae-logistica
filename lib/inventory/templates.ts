export type TemplateFieldType =
  | "text"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "boolean";

export type InventoryTemplateField = {
  key: string;
  label: string;
  type: TemplateFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

export type InventoryTemplateDefinition = {
  id?: string;
  code: string;
  name: string;
  category: string;
  categoryName?: string;
  description: string;
  fields: InventoryTemplateField[];
};
