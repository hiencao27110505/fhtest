import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    SERVER_URL: z.url().optional(),
    DATABASE_URL: z.string().startsWith("postgresql"),
  },

  /**
   * The prefix that client-side variables must have. This is enforced both at
   * a type-level and at runtime.
   */
  clientPrefix: "VITE_",

  client: {
    /**
     * The browser client needs these too, and Vite only exposes `VITE_`-prefixed
     * vars to the bundle. Both are safe to ship publicly: the anon key is
     * designed to be public and is gated by RLS.
     */
    VITE_SUPABASE_URL: z.url(),
    VITE_SUPABASE_ANON_KEY: z.string().nonempty(),
  },

  /**
   * What object holds the environment variables at runtime.
   *
   * Server vars come from `process.env` — Vite only exposes `VITE_`-prefixed
   * vars on `import.meta.env`, so `DATABASE_URL` would read as undefined there.
   * Client vars come from `import.meta.env` so they get statically replaced in
   * the browser bundle.
   */
  runtimeEnv: {
    ...process.env,
    ...import.meta.env,
  },

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   *
   * This means that if you have an empty string for a value that is supposed
   * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
   * it as a type mismatch violation. Additionally, if you have an empty string
   * for a value that is supposed to be a string with a default value (e.g.
   * `DOMAIN=` in an ".env" file), the default value will never be applied.
   *
   * In order to solve these issues, we recommend that all new projects
   * explicitly specify this option as true.
   */
  emptyStringAsUndefined: true,
});

/**
 * Mode flags, read from Vite rather than from `env` above.
 *
 * `NODE_ENV` is declared server-only, so reading it through the t3-env proxy
 * throws on the client — and because `__root.tsx` renders in the browser, that
 * throw happened during hydration and took the whole client render down with
 * it (a permanently "loading" auth state was the visible symptom).
 *
 * `import.meta.env.DEV`/`.PROD` are statically replaced by Vite in both
 * bundles, so they are safe everywhere and cost nothing at runtime.
 */
export const isProduction = import.meta.env.PROD;
export const isDevelopment = import.meta.env.DEV;
