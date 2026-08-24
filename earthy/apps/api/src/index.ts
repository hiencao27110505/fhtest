import { pool } from "@earthy/db";

import { app } from "./app";
import { env } from "./lib/env";

const server = Bun.serve({
  // Explicit, though Bun already binds every interface by default: it REPORTS
  // `server.hostname` as "localhost" while actually listening on 0.0.0.0, so
  // the default looks wrong to anyone reading a log line or this code. Cloud
  // Run's container contract requires listening on 0.0.0.0 — a loopback-only
  // bind fails its startup probe — and that requirement is too load-bearing to
  // rest on an undocumented default that prints the opposite of what it does.
  hostname: "0.0.0.0",
  port: env.PORT,
  fetch: app.fetch,
});

console.info(`Listening on http://localhost:${server.port}`);

/**
 * How long in-flight requests get to finish before the process exits anyway.
 *
 * Under Cloud Run's container contract SIGTERM is followed by SIGKILL after
 * ~10 seconds, so a longer budget than that is not a budget — the platform
 * stops the process mid-drain and the "forcing exit" branch below never runs,
 * turning a controlled shutdown into an uncontrolled one. Staying under the
 * platform's own deadline is what keeps the drain ours to complete: we finish,
 * log, and exit 0 before anything is killed.
 */
const SHUTDOWN_TIMEOUT_MS = 8_000;

let shuttingDown = false;

/**
 * Drains the server on a termination signal.
 *
 * Order matters: stop accepting connections first, let in-flight requests
 * finish, and only then close the database pool — draining it earlier would
 * fail the very requests we are waiting on. A hard timer bounds the wait so a
 * hung request cannot block the process forever, and the guard makes a second
 * signal (an impatient Ctrl-C) exit immediately instead of re-entering.
 */
async function shutdown(signal: string) {
  if (shuttingDown) {
    console.warn(`Received ${signal} again, exiting now.`);
    process.exit(1);
  }
  shuttingDown = true;

  console.info(`Received ${signal}, shutting down.`);

  const forceExit = setTimeout(() => {
    console.error(
      `Did not finish within ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`,
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // Do not let the timer itself hold the event loop open.
  forceExit.unref?.();

  try {
    await server.stop(false); // `false` lets in-flight requests run to completion.
    await pool.end();
    console.info("Shutdown complete.");
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err);
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
