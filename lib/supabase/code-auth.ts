import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// OTP verification must not replace the browser session (or an administrator's session).
// Its short-lived session remains exclusively inside the server action.
export function createCodeAuthClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}
