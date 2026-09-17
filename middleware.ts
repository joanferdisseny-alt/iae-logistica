import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values: Array<{ name: string; value: string; options: CookieOptions }>) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  // Keep the scanned stock label as the destination after signing in.
  if (!user && request.method === "GET" && request.nextUrl.pathname.startsWith("/dashboard/stock/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.search = "";
    url.searchParams.set("next", request.nextUrl.pathname);
    const login = NextResponse.redirect(url);
    response.cookies.getAll().forEach(cookie => login.cookies.set(cookie));
    return login;
  }
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*"]
};
