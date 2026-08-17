import { createFileRoute } from "@tanstack/react-router";
import { createServerClient } from "#/integrations/supabase/server.ts";
import {
  callbackQuerySchema,
  parseQuery,
  redirectTo,
  redirectToError,
} from "#/integrations/supabase/utils.ts";

/**
 * OAuth (PKCE) redirect target.
 *
 * The provider sends the user back here with `?code=...`. Exchanging that code
 * produces a session, and the exchange writes the auth cookies through the
 * `setAll` handler in `integrations/supabase/server.ts` — which is why this has
 * to run on the server and not in a component.
 *
 * Register this exact URL in the Supabase dashboard under
 * Authentication -> URL Configuration -> Redirect URLs.
 */
export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);

        const parsed = parseQuery(callbackQuerySchema, url);
        if (parsed.error) {
          return redirectToError(url, "invalid_callback_request");
        }

        const query = parsed.data;

        // The provider reports user-facing failures (denied consent, etc.)
        // as query params rather than a non-2xx status. On that arm there is
        // no code to exchange, so this has to come first.
        if ("error" in query) {
          return redirectToError(url, query.error_description ?? query.error);
        }

        const supabase = createServerClient();
        const { error } = await supabase.auth.exchangeCodeForSession(
          query.code,
        );

        if (error) {
          return redirectToError(url, error.message);
        }

        return redirectTo(url, query.next);
      },
    },
  },
});
