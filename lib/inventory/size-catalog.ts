export type SizeVariant = {
  id: string;
  name: string;
  size: string | null;
  quantity: number;
  status: string;
  expiration_date: string | null;
  operational_status: string;
};

export type SizeProduct = {
  id: string;
  name: string;
  is_size_group: boolean;
  current_stock: number;
  unit: string | null;
  size_count: number;
  variants: SizeVariant[];
};

const sizes = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "SIN TALLA"];

export function sortedSizeVariants(variants: SizeVariant[]) {
  const rank = (size: string | null) => {
    const index = sizes.indexOf(size?.toUpperCase() ?? "");
    return index < 0 ? sizes.length : index;
  };
  return [...variants].sort((a, b) => rank(a.size) - rank(b.size)
    || (a.size ?? "").localeCompare(b.size ?? "", "es", { numeric: true })
    || a.id.localeCompare(b.id));
}

export function sizeTotals(variants: SizeVariant[]) {
  const totals = new Map<string, number>();
  for (const variant of sortedSizeVariants(variants)) {
    const size = variant.size ?? "Sin talla";
    totals.set(size, (totals.get(size) ?? 0) + Number(variant.quantity));
  }
  return [...totals].map(([size, quantity]) => ({ size, quantity }));
}
