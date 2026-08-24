import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { connectionsRoutes } from "./features/connections/routes";
import { env } from "./lib/env";
import { privateRoutes, todosRoutes } from "./routes";

/**
 * The Hono app, kept separate from the server entry point so it can be mounted
 * or exercised in tests without binding a port.
 */
export const app = new Hono();

app.use("*", logger());
// Origins are listed, never `*`. The API accepts the Supabase session cookie
// as a credential, and browsers refuse a credentialed response whose
// `Allow-Origin` is a wildcard — with `cors()` bare, every cookie-authenticated
// fetch from the web app fails before it reaches a route.
app.use(
  "*",
  cors({
    origin: env.WEB_ORIGINS,
    credentials: true,
    // `Location` is not a CORS-safelisted response header, so without this a
    // browser hides it from script even on a 2xx/3xx it can otherwise read.
    // The authorize endpoint answers 302 to Google's consent screen, and the
    // client reads that header with `redirect: "manual"` rather than following
    // it — following it would put the browser on accounts.google.com as a
    // cross-origin fetch, which Google refuses. Without this line the client
    // gets an opaque redirect with nowhere to go.
    exposeHeaders: ["Location"],
  }),
);

app.onError((err, c) => {
  // Re-serialize rather than returning err.getResponse(): that response carries
  // a plain-text body and no content-type, which browsers reject outright
  // (ERR_INVALID_RESPONSE). This keeps every error on the same JSON shape.
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.get("/health", (c) => c.json({ status: "ok" }));

const routes = app
  .route("/", todosRoutes)
  .route("/", privateRoutes)
  .route("/", connectionsRoutes);

// Exported so a client can infer the route types via hono/client.
export type AppType = typeof routes;
