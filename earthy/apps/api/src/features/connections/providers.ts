import { GMAIL_SCOPES } from "./google-oauth";

/**
 * The providers a user can connect, as data rather than as routes.
 *
 * Every provider-specific fact lives in one entry here, so adding the next one
 * is a new record — not a new copy of the four endpoints. The routes stay
 * `/connections/:provider/...` and read what they need from this table.
 */

/** Providers this API can connect. The single source of what is supported. */
export const PROVIDERS = {
  google: {
    /** Scopes the pipeline needs. A grant narrower than this is refused. */
    scopes: GMAIL_SCOPES,
    /** Shown in errors and logs. */
    label: "Google",
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

/** Narrows an arbitrary path segment to a supported provider. */
export function isProvider(value: string): value is ProviderId {
  return Object.hasOwn(PROVIDERS, value);
}

/**
 * Provider ids as a plain array, for a Zod enum.
 *
 * Cast because `Object.keys` widens to `string[]`, losing exactly the literal
 * union that makes the routes type-safe.
 */
export const PROVIDER_IDS = Object.keys(PROVIDERS) as [ProviderId, ...ProviderId[]];
