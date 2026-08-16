import { createFileRoute } from "@tanstack/react-router";
import { createServerClient } from "#/integrations/supabase/server.ts";
import {
  parseQuery,
  redirectTo,
  redirectToError,
  verifyQuerySchema,
} from "#/integrations/supabase/utils.ts";

/**
 * Email-link verification target.
 *
 * Distinct from `/callback`: OAuth returns a PKCE `?code`, whereas email links
 * carry `?token_hash=...&type=...` and go through `verifyOtp`. Even on an
 * OAuth-only setup this route still earns its place, because email-change
 * confirmations and account recovery links land here.
 *
 * Point Supabase's email templates at this URL, e.g.
 *   {{ .SiteURL }}/api/auth/verify?token_hash={{ .TokenHash }}&type=email
 */
export const Route = createFileRoute("/api/auth/verify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);

        // The schema carries the whole shape of a valid link: both fields
        // present, and `type` one of the OTP types Supabase actually sends.
        const parsed = parseQuery(verifyQuerySchema, url);
        if (parsed.error) {
          return redirectToError(url, "invalid_verification_link");
        }
        const { token_hash, type, next } = parsed.data;

        const supabase = createServerClient();
        const { error } = await supabase.auth.verifyOtp({ type, token_hash });

        if (error) {
          return redirectToError(url, error.message);
        }

        return redirectTo(url, next);
      },
    },
  },
});
