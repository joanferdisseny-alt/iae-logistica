import "server-only";
import { z } from "zod";
import { parseProductResponse, validProductCode, type ProductProvider, type ProductResearchResult } from "./product-research";

const cache = new Map<string, { expires: number; result: ProductResearchResult }>();
const running = new Map<string, Promise<ProductResearchResult>>();
const users = new Map<string, { count: number; until: number }>();
const budgets = new Map<ProductProvider, { minute: number; count: number; day: number; daily: number; blockedUntil: number }>();
const MAX_BYTES = 256 * 1024;

export function allowProductResearch(userId: string, now = Date.now()): boolean {
  for (const [id, entry] of users) if (entry.until <= now) users.delete(id);
  const previous = users.get(userId);
  if (previous) return ++previous.count <= 6;
  if (users.size >= 1000) return false;
  users.set(userId, { count: 1, until: now + 60000 });
  return true;
}

function takeBudget(provider: ProductProvider, now: number): boolean {
  const budget = budgets.get(provider) ?? { minute: now, count: 0, day: now, daily: 0, blockedUntil: 0 };
  if (now - budget.minute >= 60000) { budget.minute = now; budget.count = 0; }
  if (now - budget.day >= 86400000) { budget.day = now; budget.daily = 0; }
  budgets.set(provider, budget);
  if (budget.blockedUntil > now || budget.count >= (provider === "upcitemdb" ? 5 : 10) || (provider === "upcitemdb" && budget.daily >= 90)) return false;
  budget.count++; budget.daily++;
  return true;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw Error("Response too large");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error("Response too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function query(provider: ProductProvider, code: string): Promise<ProductResearchResult> {
  const contact = z.string().email().max(254).safeParse(process.env.PRODUCT_LOOKUP_CONTACT?.trim());
  if (provider === "openfoodfacts" && !contact.success) return { error: "Para activar Open Food Facts, administración debe configurar PRODUCT_LOOKUP_CONTACT con un correo técnico de contacto. Puedes usar Productos generales o continuar manualmente." };
  if (!takeBudget(provider, Date.now())) return { error: "Se ha alcanzado el límite temporal de consultas. Espera o utiliza el alta manual." };
  // Fixed hosts, no redirects or user-supplied URLs: never fetch manuals/images from provider responses.
  const url = provider === "upcitemdb"
    ? `https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`
    : `https://world.openfoodfacts.org/api/v3/product/${code}.json?fields=code,product_name_es,product_name,brands,generic_name_es,generic_name,quantity,ingredients_text_es,ingredients_text`;
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json", "User-Agent": provider === "openfoodfacts" && contact.success ? `IAE-Logistica/1.0 (${contact.data})` : "IAE-Logistica/1.0" } });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      budgets.get(provider)!.blockedUntil = Date.now() + Math.min(86400000, Math.max(60, Number.isFinite(seconds) ? seconds : 60)) * 1000;
      await response.body?.cancel();
      return { error: "El catálogo externo ha agotado su cuota. Prueba más tarde u otro catálogo; puedes continuar manualmente." };
    }
    if (response.status === 404) { await response.body?.cancel(); return { notFound: true }; }
    if (!response.ok) { await response.body?.cancel(); throw Error("Provider unavailable"); }
    const data = await readJson(response);
    // A provider failure is not a confirmed absence of a product.
    const root = data as { code?: unknown; status?: unknown; result?: { id?: unknown } } | null;
    if (!root || (provider === "upcitemdb" ? root.code !== "OK" : root.result?.id !== "product_found" && root.result?.id !== "product_not_found")) throw Error("Invalid provider response");
    const candidate = parseProductResponse(provider, code, data);
    return candidate ? { candidate } : { notFound: true };
  } catch { return { error: "No se ha podido consultar el catálogo externo. No se ha modificado el inventario. Puedes reintentar o continuar manualmente." }; }
}

export async function fetchProductResearch(provider: ProductProvider, code: string): Promise<ProductResearchResult> {
  if (!["upcitemdb", "openfoodfacts"].includes(provider) || !validProductCode(code)) return { error: "La búsqueda online admite EAN/UPC/GTIN válidos. Los códigos internos se pueden registrar manualmente." };
  const key = `${provider}:${code}`; const now = Date.now();
  const saved = cache.get(key);
  if (saved && saved.expires > now) return saved.result;
  const pending = running.get(key); if (pending) return pending;
  const task = query(provider, code).then(result => {
    if (!result.error) {
      for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
      if (cache.size >= 250) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + (result.candidate ? 6 * 3600000 : 300000), result });
    }
    return result;
  }).finally(() => running.delete(key));
  running.set(key, task);
  return task;
}
