import { z } from "zod";

export const requestStatuses = ["pending", "accepted", "preparing", "completed", "cancelled"] as const;
export type RequestStatus = (typeof requestStatuses)[number];
export const statusLabels: Record<RequestStatus, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  preparing: "En preparacion",
  completed: "Completada",
  cancelled: "Cancelada"
};
export const statusClasses: Record<RequestStatus, string> = {
  pending: "ec-badge-warn", accepted: "ec-badge-neutral", preparing: "ec-badge-warn",
  completed: "ec-badge-ok", cancelled: "ec-badge-bad"
};
export const nextStatuses: Record<RequestStatus, readonly RequestStatus[]> = {
  pending: ["accepted", "cancelled"], accepted: ["preparing", "cancelled"],
  preparing: ["completed", "cancelled"], completed: [], cancelled: []
};

export const createRequestSchema = z.object({
  headquartersId: z.string().uuid(),
  itemId: z.string().uuid().nullable().optional(),
  material: z.string().trim().min(2).max(160),
  quantity: z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/).transform(Number)
    .pipe(z.number().positive().max(999999999.999)),
  unit: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(2000)
});
export const changeStatusSchema = z.object({
  requestId: z.string().uuid(),
  expectedStatus: z.enum(requestStatuses),
  status: z.enum(requestStatuses)
}).refine((value) => nextStatuses[value.expectedStatus].includes(value.status));

export type RequestRow = {
  id: string;
  headquarters_id: string;
  created_by: string;
  material: string;
  item_id: string | null;
  quantity: number;
  unit: string;
  notes: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  headquarters: { name: string } | null;
};
export type RequestActionState = { error?: string; success?: string };

export type RequestArticle = {
  id: string; name: string; unit: string | null; sku: string | null; current_stock: number;
};

export function allowedStatuses(status: RequestStatus, canManage: boolean, isOwner: boolean) {
  return canManage ? nextStatuses[status] : isOwner && status === "pending" ? ["cancelled"] as const : [];
}

export function formatRequestDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid"
  }).format(new Date(value));
}
