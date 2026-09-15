import { handleNotificationCron } from "@/lib/notifications/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleNotificationCron(request, {
    env: process.env,
    createClient: async () => {
      // Loading this module validates env too; defer until cron auth succeeds.
      const { createAdminClient } = await import("@/lib/supabase/admin");
      return createAdminClient();
    }
  });
}
