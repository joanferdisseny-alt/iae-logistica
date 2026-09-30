import { handleDatabaseCheck } from "@/lib/database-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  return handleDatabaseCheck(request, {
    env: process.env,
    createClient: async () => {
      // Validate the cron secret before loading privileged database credentials.
      const { createAdminClient } = await import("@/lib/supabase/admin");
      return createAdminClient();
    }
  });
}
