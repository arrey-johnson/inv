/**
 * Start `next dev --turbopack` and warm primary routes once the server is up.
 * Cross-platform (Windows / macOS / Linux).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT || "3001";
const base = process.env.APP_URL || `http://localhost:${port}`;

const next = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--turbopack", "-p", port],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: process.env },
);

const warmer = spawn(process.execPath, [path.join(root, "scripts", "warm-routes.mjs"), base], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

function shutdown(code = 0) {
  if (!next.killed) next.kill("SIGTERM");
  if (!warmer.killed) warmer.kill("SIGTERM");
  process.exit(code);
}

next.on("exit", (code) => shutdown(code ?? 0));
warmer.on("exit", () => {
  // Warm finished; leave Next running.
});
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
