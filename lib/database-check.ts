import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type Dependencies = {
  env: Record<string, string | undefined>;
  createClient: () => SupabaseClient | Promise<SupabaseClient>;
};

function response(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleDatabaseCheck(request: Request, { env, createClient }: Dependencies) {
  const secret = env.CRON_SECRET;
  if (!secret?.trim() || /[\r\n]/.test(secret)) {
    return response(503, { ok: false, error: "Cron authentication is not configured" });
  }
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return response(401, { ok: false, error: "Unauthorized" });
  }

  const started = Date.now();
  try {
    // Read an existing, small catalogue; no migration, stock writes or email dependency.
    const db = await createClient();
    const { error } = await db.from("app_roles").select("code").limit(1)
      .abortSignal(AbortSignal.timeout(8000));
    if (error) throw new Error("database_unavailable");
    return response(200, { ok: true, checkedAt: new Date().toISOString(), durationMs: Date.now() - started });
  } catch {
    // Do not log provider errors: they may include connection details or credentials.
    console.error("[database-check] Database query failed or timed out");
    return response(503, { ok: false, error: "Database check failed" });
  }
}
