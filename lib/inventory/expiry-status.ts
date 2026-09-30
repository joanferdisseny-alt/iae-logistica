export function inventoryToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function currentInventoryStatus(item: {
  status: string; current_stock: number; expiration_date: string | null;
}, today: string) {
  // SQL recalculates stock on mutations, but passing midnight is not a mutation.
  return item.current_stock > 0 && item.expiration_date && item.expiration_date < today
    ? "expired" : item.status;
}

export function filterInventoryStatus(query: {
  eq(column: string, value: string): unknown;
  gt(column: string, value: number): unknown;
  lt(column: string, value: string): unknown;
  or(filters: string): unknown;
}, status: string, today: string) {
  if (!status) return;
  if (status === "expired") {
    query.gt("current_stock", 0);
    query.lt("expiration_date", today);
  } else {
    query.eq("status", status);
    query.or(`expiration_date.is.null,expiration_date.gte.${today},current_stock.eq.0`);
  }
}
