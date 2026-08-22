import { pool } from "@earthy/db";

import { app } from "./app";
import { env } from "./lib/env";

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

console.info(`Listening on http://localhost:${server.port}`);

/** How long in-flight requests get to finish before the process exits anyway. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

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
