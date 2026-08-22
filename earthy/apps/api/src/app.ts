import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { privateRoutes, todosRoutes } from "./routes";

/**
 * The Hono app, kept separate from the server entry point so it can be mounted
 * or exercised in tests without binding a port.
 */
export const app = new Hono();

app.use("*", logger());
app.use("*", cors());

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

const routes = app.route("/", todosRoutes).route("/", privateRoutes);

// Exported so a client can infer the route types via hono/client.
export type AppType = typeof routes;
