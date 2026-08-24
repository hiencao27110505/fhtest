/**
 * Fernet interop tests.
 *
 * The property that matters is not "this produces a Fernet token" but "the
 * Python pipeline can decrypt what this writes" — those are the same claim
 * only if this implementation is right in every detail, which is exactly what
 * is being questioned. So the assertion is made by actually running
 * `cryptography.fernet` over the output.
 *
 * The suite skips when serverless/'s virtualenv is absent, so a checkout
 * without the Python side still runs green.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { fernetEncrypt } from "./fernet";

/**
 * The Python interpreter that holds `cryptography`.
 *
 * Found by walking up to the workspace root rather than by counting `../`
 * segments: this file has already moved once, and a stale relative path does
 * not fail here — it makes `existsSync` false and the whole suite skips, which
 * looks exactly like a green run.
 */
function findPython(): string {
  for (
    let dir = import.meta.dir;
    dir !== dirname(dir);
    dir = dirname(dir)
  ) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return resolve(dir, "serverless/.venv/bin/python");
    }
  }
  throw new Error("workspace root not found from " + import.meta.dir);
}

const PYTHON = findPython();
const KEY = "hyDaMEQKvIYFYt6NIzalpBEyM5f6dxT_uxCyzWSbEE4=";

/** Decrypts with the real Python implementation, the one that reads our rows. */
async function pythonDecrypt(token: string, key: string): Promise<string> {
  const proc = Bun.spawn(
    [
      PYTHON,
      "-c",
      [
        "import sys",
        "from cryptography.fernet import Fernet",
        "key, token = sys.argv[1], sys.argv[2]",
        "sys.stdout.write(Fernet(key.encode()).decrypt(token.encode()).decode())",
      ].join("\n"),
      key,
      token,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(err);
  return out;
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe.if(existsSync(PYTHON))("fernetEncrypt", () => {
  test("Python decrypts what we encrypt", async () => {
    const token = decode(await fernetEncrypt("a-refresh-token", KEY));
    expect(await pythonDecrypt(token, KEY)).toBe("a-refresh-token");
  });

  test("a realistic Google refresh token survives the round trip", async () => {
    // Long, and full of the characters base64 handling tends to mangle.
    const secret = `1//0e${"aA9-_zZ".repeat(20)}`;
    const token = decode(await fernetEncrypt(secret, KEY));
    expect(await pythonDecrypt(token, KEY)).toBe(secret);
  });

  test("a wrong key does not decrypt", async () => {
    const other = "5cX3rC5Zd9uNfPZbXk3sT_JnE9wHc1kQ0m2VYb7pLq8=";
    const token = decode(await fernetEncrypt("secret", KEY));
    await expect(pythonDecrypt(token, other)).rejects.toThrow();
  });

  test("each call uses a fresh IV", async () => {
    // Reusing an IV across two encryptions under one key leaks whether two
    // mailboxes share a token prefix.
    const a = decode(await fernetEncrypt("same", KEY));
    const b = decode(await fernetEncrypt("same", KEY));
    expect(a).not.toBe(b);
  });

  test("a key that is not 32 bytes is rejected with an actionable message", async () => {
    await expect(fernetEncrypt("x", "dG9vLXNob3J0")).rejects.toThrow(
      /32 bytes/,
    );
  });
});
