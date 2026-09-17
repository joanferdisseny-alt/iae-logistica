import { z } from "zod";

// Legacy history and pending-creation compatibility only. No external requests.
type ProductProvider = "upcitemdb" | "openfoodfacts";
export const productProviders: Record<ProductProvider, string> = {
  upcitemdb: "UPCitemdb", openfoodfacts: "Open Food Facts"
};

function validProductCode(code: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code) || /^0+$/.test(code)) return false;
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(code[i]) * weight;
  return (10 - sum % 10) % 10 === Number(code.at(-1));
}

export function productSourceUrl(provider: ProductProvider, code: string): string {
  return provider === "upcitemdb" ? `https://www.upcitemdb.com/upc/${code}` : `https://world.openfoodfacts.org/product/${code}`;
}

export const productSourceSchema = z.object({
  provider: z.enum(["upcitemdb", "openfoodfacts"]),
  code: z.string().refine(validProductCode),
  fetchedAt: z.string().datetime(),
  reviewed: z.literal(true)
}).strict();
export type ProductSource = z.infer<typeof productSourceSchema>;
