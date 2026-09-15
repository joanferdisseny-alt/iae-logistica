import { z } from "zod";

export type RoleRecord = { id: string; code: string; name: string };
export type HeadquartersRow = { id: string; name: string; is_active: boolean };
export type AdminProfileRow = {
  id: string;
  full_name: string | null;
  is_active: boolean;
  headquarters_id: string | null;
  is_logistics_contact: boolean;
  notification_preferences: { notification_email: string; expiry_warning_days: number; email_notifications_enabled: boolean } | null;
  app_roles: { code: string; name: string } | null;
  headquarters: { name: string } | null;
};
export const usersPageSize = 25;
export function parseUserFilters(params: Record<string, string | string[] | undefined>) {
  const single = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const rawPage = Number(single("page") || 1);
  const site = single("site");
  const status = single("status");
  return {
    q: single("q").trim().slice(0, 120),
    site: z.string().uuid().safeParse(site).success ? site : "",
    status: status === "active" || status === "inactive" ? status : "",
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1
  };
}
export function userListHref(filters: ReturnType<typeof parseUserFilters>, page: number) {
  const params = new URLSearchParams({ page: String(page) });
  if (filters.q) params.set("q", filters.q);
  if (filters.site) params.set("site", filters.site);
  if (filters.status) params.set("status", filters.status);
  return `/dashboard/users?${params}`;
}
export function escapeUserSearch(query: string) {
  return query.replace(/[\\%_]/g, "\\$&");
}
