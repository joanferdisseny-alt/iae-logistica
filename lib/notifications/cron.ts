import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

type AlertType = "expiry" | "low_stock" | "maintenance";
type Preference = {
  profile_id: string;
  notification_email: string | null;
  expiry_warning_days: number;
  email_notifications_enabled: boolean;
  profiles: {
    is_active: boolean;
    is_logistics_contact: boolean;
    headquarters_id: string | null;
    app_roles: { code: string } | null;
  } | null;
};
type Location = {
  id: string;
  name: string;
  headquarters_id: string | null;
  parent_location_id: string | null;
};
type Placement = {
  inventory_containers: {
    name: string;
    headquarters_id: string;
    location_id: string | null;
  } | null;
};
type Item = {
  stock_positions?: StockPlacement[];
  id: string;
  name: string;
  headquarters_id: string | null;
  location_id: string | null;
  expiration_date: string | null;
  maintenance_due_at: string | null;
  status: string;
  operational_status: string | null;
  current_stock: number;
  minimum_stock: number | null;
  unit: string | null;
  inventory_container_items: Placement[] | Placement | null;
};
type StockPlacement = {
  id: string; item_id: string; quantity: number; location_id: string | null;
  inventory_containers: Placement["inventory_containers"];
  inventory_stock_lots: { code: string; expiration_date: string | null };
};
type Alert = { type: AlertType; date: string; message: string };
type Failure = { stage: string; profileId?: string; itemId?: string; type?: AlertType; code?: string };
type Environment = Record<string, string | undefined>;
type Dependencies = {
  env: Environment;
  createClient: () => SupabaseClient | Promise<SupabaseClient>;
  fetch?: typeof fetch;
  now?: () => Date;
};

const PAGE_SIZE = 500;
const DEFAULT_WARNING_DAYS = 14;
const emailSchema = z.string().email();

function validEmail(value: unknown): boolean {
  return typeof value === "string" && !/[\r\n]/.test(value) && emailSchema.safeParse(value).success;
}

function validSender(value: string | undefined): value is string {
  if (!value || /[\r\n]/.test(value)) return false;
  if (validEmail(value)) return true;
  const match = value.match(/^[^<>]+<([^<>]+)>$/);
  return !!match && validEmail(match[1]);
}

export function notificationKey(profileId: string, itemId: string, type: AlertType, date: string) {
  return `inventory-v1-${createHash("sha256").update(JSON.stringify([profileId, itemId, type, date])).digest("hex")}`;
}

export function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}

function addDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function alertsFor(item: Item, today: string, warningDays: number): Alert[] {
  const alerts: Alert[] = [];
  if (item.operational_status === "retired") return alerts;
  if (item.stock_positions) {
    const dates = [...new Set(item.stock_positions.filter(p => p.quantity>0 && p.inventory_stock_lots.expiration_date)
      .map(p => p.inventory_stock_lots.expiration_date!))].sort();
    for (const date of dates) if (date <= addDays(today,warningDays)) {
      const affected = item.stock_positions.filter(p => p.quantity>0 && p.inventory_stock_lots.expiration_date===date);
      alerts.push({ type: "expiry", date, message: `${item.name}: caducidad ${date}. Lotes: ${affected.map(p => `${p.inventory_stock_lots.code} (${p.quantity} ${item.unit ?? 'uds.'})`).join(', ')}. Revisar retirada o reposicion.` });
    }
  } else if (item.expiration_date && item.expiration_date <= addDays(today, warningDays)) {
    alerts.push({ type: "expiry", date: item.expiration_date, message: `${item.name}: fecha de caducidad ${item.expiration_date}. Revisar retirada o reposicion.` });
  }
  if (item.minimum_stock !== null && item.current_stock <= item.minimum_stock) {
    alerts.push({ type: "low_stock", date: today, message: `${item.name}: stock bajo. Revisar reposicion.` });
  }
  if ((item.maintenance_due_at && item.maintenance_due_at <= today) ||
      item.operational_status === "repair" || item.operational_status === "inspection" ||
      (!item.operational_status && item.status === "maintenance")) {
    alerts.push({ type: "maintenance", date: item.maintenance_due_at ?? today, message: `${item.name}: requiere mantenimiento${item.maintenance_due_at ? ` con fecha ${item.maintenance_due_at}` : ""}.` });
  }
  return alerts;
}

function effectiveLocation(item: Item, locations: Map<string, Location>): string {
  if (item.stock_positions) return item.stock_positions.filter(p => p.quantity>0).map(p => {
    const location = effectiveLocation({ ...item, stock_positions: undefined, location_id: p.location_id,
      inventory_container_items: p.inventory_containers ? [{ inventory_containers: p.inventory_containers }] : [] },locations);
    return `${location} · lote ${p.inventory_stock_lots.code}: ${p.quantity} ${item.unit ?? 'uds.'}`;
  }).join('; ') || 'Sin existencias';
  // PostgREST may embed a unique foreign key as one object instead of an array.
  const embedded = item.inventory_container_items;
  const placements = Array.isArray(embedded) ? embedded : embedded ? [embedded] : [];
  if (placements.length > 1) return placements.map(placement => effectiveLocation({ ...item, inventory_container_items: [placement] },locations)).join('; ');
  const box = placements[0]?.inventory_containers;
  if (placements.length && !box) throw new Error("missing_container");
  if (box && box.headquarters_id !== item.headquarters_id) throw new Error("container_headquarters_mismatch");
  let id = box ? box.location_id : item.location_id;
  const parts: string[] = [];
  const visited = new Set<string>();
  while (id) {
    if (visited.has(id)) throw new Error("location_cycle");
    visited.add(id);
    const location = locations.get(id);
    if (!location || location.headquarters_id !== item.headquarters_id) throw new Error("invalid_location");
    parts.unshift(location.name);
    id = location.parent_location_id;
  }
  if (!parts.length) parts.push("sin ubicacion");
  if (box) parts.push(`Caja: ${box.name}`);
  return parts.join(" > ");
}

function renderEmail(item: Item, alert: Alert, location: string) {
  const labels: Record<AlertType, string> = {
    expiry: "Aviso de caducidad de inventario",
    low_stock: "Aviso de stock bajo",
    maintenance: "Aviso de mantenimiento"
  };
  const subject = labels[alert.type];
  // No relative dates: retries retain their payload unless the underlying data changes.
  const html = `<div><h2>${escapeHtml(subject)}</h2><p>${escapeHtml(alert.message)}</p><p>Ubicacion: ${escapeHtml(location)}</p><p>Stock: ${escapeHtml(item.current_stock)} ${escapeHtml(item.unit ?? "uds.")}. Minimo: ${escapeHtml(item.minimum_stock ?? "sin definir")}</p></div>`;
  return { subject, html };
}

class StageError extends Error {
  constructor(public readonly stage: string, public readonly code?: string) {
    super(stage);
  }
}

async function readAll<T>(getPage: (from: number, to: number) => PromiseLike<{
  data: T[] | null;
  error: { code?: string } | null;
}>, stage: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await getPage(from, from + PAGE_SIZE - 1);
    if (error || !data) throw new StageError(stage, error?.code);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function sendEmail(fetcher: typeof fetch, apiKey: string, from: string, to: string, key: string, email: { subject: string; html: string }) {
  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key
      },
      body: JSON.stringify({ from, to: [to], ...email }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new StageError("email_provider", "network_or_timeout");
  }
  if (!response.ok) throw new StageError("email_provider", `http_${response.status}`);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new StageError("email_provider", "invalid_response"); }
  if (!payload || typeof payload !== "object" || !("id" in payload) || typeof payload.id !== "string" || !payload.id.trim()) {
    throw new StageError("email_provider", "missing_acceptance_id");
  }
}

export async function handleNotificationCron(request: Request, dependencies: Dependencies): Promise<Response> {
  const { env } = dependencies;
  const secret = env.CRON_SECRET;
  if (!secret?.trim() || /[\r\n]/.test(secret)) {
    return Response.json({ ok: false, error: "CRON_SECRET is missing or invalid" }, { status: 503 });
  }
  const matches = (actual: string | null, expected: string) => {
    const a = Buffer.from(actual ?? "");
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  if (!matches(request.headers.get("authorization"), `Bearer ${secret}`) && !matches(request.headers.get("x-cron-secret"), secret)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = env.RESEND_API_KEY;
  const from = env.ALERTS_FROM_EMAIL;
  if (!apiKey?.trim() || /\s/.test(apiKey) || !validSender(from)) {
    return Response.json({ ok: false, error: "RESEND_API_KEY or ALERTS_FROM_EMAIL is missing or invalid" }, { status: 503 });
  }

  const failures: Failure[] = [];
  let failureCount = 0;
  const fail = (failure: Failure) => {
    failureCount += 1;
    if (failures.length < 100) failures.push(failure);
  };
  let generatedAlerts = 0;
  let acceptedEmails = 0;
  let recordedEvents = 0;
  let skippedRecipients = 0;
  let alreadyNotified = 0;
  try {
    let db: SupabaseClient;
    try { db = await dependencies.createClient(); } catch { throw new StageError("admin_client_configuration"); }
    const today = (dependencies.now?.() ?? new Date()).toISOString().slice(0, 10);
    const preferences = await readAll<Preference>((start, end) => db.from("notification_preferences")
      .select("profile_id, notification_email, expiry_warning_days, email_notifications_enabled, profiles(is_active, is_logistics_contact, headquarters_id, app_roles(code))")
      .eq("email_notifications_enabled", true).order("profile_id").range(start, end).returns<Preference[]>(), "preferences_read");
    const recipients = preferences.filter((preference) => {
      const profile = preference.profiles;
      const role = profile?.app_roles?.code;
      if (preference.email_notifications_enabled !== true || profile?.is_active !== true ||
          !role || !["admin", "editor", "reader"].includes(role) ||
          (role !== "admin" && (profile.is_logistics_contact !== true || !profile.headquarters_id))) {
        skippedRecipients += 1;
        return false;
      }
      if (!validEmail(preference.notification_email) || !Number.isInteger(preference.expiry_warning_days) || preference.expiry_warning_days < 1 || preference.expiry_warning_days > 365) {
        fail({ stage: "recipient_configuration", profileId: preference.profile_id });
        skippedRecipients += 1;
        return false;
      }
      return true;
    });
    const warningDays = recipients.reduce((days, recipient) => Math.max(days, recipient.expiry_warning_days), DEFAULT_WARNING_DAYS);
    const locations = new Map((await readAll<Location>((start, end) => db.from("locations")
      .select("id, name, headquarters_id, parent_location_id").order("id").range(start, end).returns<Location[]>(), "locations_read")).map((location) => [location.id, location]));
    const items = await readAll<Item>((start, end) => db.from("inventory_items")
      .select("id, name, headquarters_id, location_id, expiration_date, maintenance_due_at, status, operational_status, current_stock, minimum_stock, unit, inventory_container_items(inventory_containers(name, headquarters_id, location_id))")
      .order("id").range(start, end).returns<Item[]>(), "inventory_read");
    const positions = await readAll<StockPlacement>((start,end) => db.from("inventory_stock_positions")
      .select("id, item_id, quantity, location_id, inventory_containers(name, headquarters_id, location_id), inventory_stock_lots(code, expiration_date)")
      .order("id").range(start,end).returns<StockPlacement[]>(), "stock_positions_read");
    const positionsByItem = new Map<string, StockPlacement[]>();
    for (const position of positions) {
      const rows = positionsByItem.get(position.item_id) ?? [];
      rows.push(position); positionsByItem.set(position.item_id, rows);
    }
    for (const item of items) item.stock_positions = positionsByItem.get(item.id);

    for (const item of items) {
      for (const alert of alertsFor(item, today, warningDays)) {
        const { data, error } = await db.from("alerts").upsert({
          item_id: item.id, alert_type: alert.type, status: "open", trigger_date: alert.date, message: alert.message
        }, { onConflict: "item_id,alert_type,trigger_date", ignoreDuplicates: true }).select("id");
        if (error || !data) {
          fail({ stage: "alert_write", itemId: item.id, type: alert.type, code: error?.code });
          continue;
        }
        generatedAlerts += data.length;
        for (const recipient of recipients) {
          if (recipient.profiles!.app_roles!.code !== "admin" && recipient.profiles!.headquarters_id !== item.headquarters_id) continue;
          if (alert.type === "expiry" && alert.date > addDays(today, recipient.expiry_warning_days)) continue;
          const context = { profileId: recipient.profile_id, itemId: item.id, type: alert.type };
          try {
            const { data: existing, error: eventError } = await db.from("notification_events").select("id")
              .eq("profile_id", recipient.profile_id).eq("item_id", item.id)
              .eq("alert_type", alert.type).eq("sent_for_date", alert.date).limit(1);
            if (eventError || !existing) throw new StageError("events_read", eventError?.code);
            if (existing.length) { alreadyNotified += 1; continue; }
            let location: string;
            try { location = effectiveLocation(alert.type==='expiry' && item.stock_positions
              ? { ...item, stock_positions: item.stock_positions.filter(p => p.inventory_stock_lots.expiration_date===alert.date) } : item, locations); } catch { throw new StageError("item_location_integrity"); }
            await sendEmail(dependencies.fetch ?? fetch, apiKey, from, recipient.notification_email!,
              notificationKey(recipient.profile_id, item.id, alert.type, alert.date), renderEmail(item, alert, location));
            acceptedEmails += 1;
            // Records provider acceptance, not final delivery. Never write before acceptance.
            const { error: writeError } = await db.from("notification_events").insert({
              profile_id: recipient.profile_id, item_id: item.id, alert_type: alert.type, sent_for_date: alert.date
            });
            if (writeError && writeError.code !== "23505") throw new StageError("event_write_after_acceptance", writeError.code);
            if (!writeError) recordedEvents += 1;
          } catch (error) {
            fail({ ...context, stage: error instanceof StageError ? error.stage : "notification_processing", code: error instanceof StageError ? error.code : undefined });
          }
        }
      }
    }
  } catch (error) {
    fail({ stage: error instanceof StageError ? error.stage : "cron_processing", code: error instanceof StageError ? error.code : undefined });
  }
  return Response.json({ ok: failureCount === 0, generatedAlerts, acceptedEmails, recordedEvents, skippedRecipients, alreadyNotified, failureCount, failures }, { status: failureCount ? 500 : 200 });
}
