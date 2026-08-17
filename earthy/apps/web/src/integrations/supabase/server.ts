import {
  getCookies,
  setCookie,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { env } from "#/env.ts";

export function createServerClient() {
  return createSupabaseServerClient(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return Object.entries(getCookies()).map(([name, value]) => ({
            name,
            value,
          }));
        },
        setAll(cookies, headers) {
          // `options` carries Max-Age, HttpOnly, SameSite and Path. Dropping it
          // turns the auth tokens into session cookies that die with the tab.
          cookies.forEach((cookie) => {
            setCookie(cookie.name, cookie.value, cookie.options);
          });
          // Responses that set auth cookies must never be cached by a CDN, or
          // one user's token can be served to another.
          Object.entries(headers).forEach(([key, value]) => {
            setResponseHeader(key, value);
          });
        },
      },
    },
  );
}
