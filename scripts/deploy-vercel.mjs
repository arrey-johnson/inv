/**
 * Link (if needed), sync env from `.env.local`, and deploy to Vercel production.
 * Prerequisites: `npx vercel login` once on this machine.
 *
 *   npm run deploy:vercel
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNpx(args) {
  const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vercel@latest", ...args], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runNode(scriptRel) {
  const result = spawnSync(process.execPath, [path.join(root, scriptRel)], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const linked = fs.existsSync(path.join(root, ".vercel", "project.json"));
if (!linked) {
  console.log("Linking project to Vercel ...");
  runNpx(["link", "--yes"]);
}

console.log("Syncing environment variables from .env.local ...");
runNode("scripts/sync-vercel-env.mjs");

console.log("Deploying to production ...");
runNpx(["deploy", "--prod", "--yes"]);
