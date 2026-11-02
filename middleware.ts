import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { NETWORK_COOKIE, networkSecret, verifyNetworkToken } from "./lib/network-gate";
import { ACTIVITY_COOKIE, activityCookieOptions, signActivityToken, verifyActivityToken } from "./lib/idle-session";

// Every CRM (staff) page needs a signed-in user; customer pages (/d, /u), the login pages and
// the API routes stay public. Server actions still check the session/role themselves.
const CRM_PREFIXES = ["/user-menu", "/inbox", "/admin-menu", "/estimates", "/leads", "/operations", "/follow-up", "/recurring", "/performance", "/recent", "/search", "/reports"];
const isCrmPath = (path: string) => CRM_PREFIXES.some(p => path === p || path.startsWith(`${p}/`));

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // One-click List-Unsubscribe (RFC 8058): a plain POST to /u/<token> -> the opt-out API.
  // (The page's own server action also POSTs here, with a Next-Action header: leave that alone.)
  if (path.startsWith("/u/")) {
    if (request.method === "POST" && !request.headers.get("next-action")) {
      const token = path.slice(3).split("/")[0];
      return NextResponse.rewrite(new URL(`/api/email/unsubscribe/${encodeURIComponent(token)}`, request.url));
    }
    return NextResponse.next();
  }
  // Network Login first: User Login and every CRM page need the network step from / in this
  // browser session; otherwise back to the Network Login.
  if ((path === "/user-login" || isCrmPath(path)) && !(await verifyNetworkToken(request.cookies.get(NETWORK_COOKIE)?.value, networkSecret()))) {
    return redirectTo(request, "/");
  }
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const protectedPath = isCrmPath(request.nextUrl.pathname);

  if (!url || !anonKey) {
    if (protectedPath) return redirectTo(request, "/user-login?error=configuration");
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        // Keep refreshed session cookies on the response we actually return.
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
          });
        });
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (protectedPath && !user) return redirectTo(request, "/user-login");
  // Deactivated users lose access on the next page load.
  if (protectedPath && user) {
    const { data: profile } = await supabase.from("user_profiles").select("is_active").eq("user_id", user.id).maybeSingle();
    if (!profile?.is_active) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return redirectTo(request, "/user-login?error=access");
    }
  }
  // Inactivity backstop (lib/idle-session.ts): a stale activity cookie = idle too long -> sign out.
  const secret = networkSecret();
  if (protectedPath && user && secret) {
    const token = request.cookies.get(ACTIVITY_COOKIE)?.value;
    const isNavigation = request.method === "GET" && !request.headers.get("next-action");
    if (token && !(await verifyActivityToken(token, secret))) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      const out = redirectTo(request, "/?error=idle");
      response.cookies.getAll().forEach(c => out.cookies.set(c));
      out.cookies.delete(NETWORK_COOKIE);
      out.cookies.delete(ACTIVITY_COOKIE);
      return out;
    }
    // Opening a CRM page is activity; a missing cookie (session from before this feature) starts the timer.
    // Background polls (server actions) never renew it.
    if (isNavigation || !token) response.cookies.set(ACTIVITY_COOKIE, await signActivityToken(secret), activityCookieOptions());
  }
  return response;
}

export const config = {
  matcher: ["/user-login", "/user-menu/:path*", "/inbox/:path*", "/admin-menu/:path*", "/estimates/:path*", "/leads/:path*", "/operations/:path*", "/follow-up/:path*", "/recurring/:path*", "/performance/:path*", "/recent/:path*", "/search/:path*", "/reports/:path*", "/u/:path*"],
};
