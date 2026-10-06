/**
 * Push required production env vars from `.env.local` into the linked Vercel project.
 * Values are never printed. Usage (after `npx vercel login` + `npx vercel link`):
 *   node scripts/sync-vercel-env.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.local");

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DOCUMENT_LINK_SECRET",
  "DEFAULT_ORGANIZATION_ID",
];

const OPTIONAL_DEFAULTS = {
  DEMO_MODE: "false",
  BRANDING_SOURCE: "storage",
  EMAIL_PROVIDER: "none",
};

const SECRET_KEYS = new Set([
  "SUPABASE_SERVICE_ROLE_KEY",
  "DOCUMENT_LINK_SECRET",
  "RESEND_API_KEY",
]);

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function vercelEnvAdd(key, value, environment) {
  // Vercel CLI 62+: NEXT_PUBLIC_ credential-looking values require --type config;
  // private secrets use --type secret (not --sensitive with NEXT_PUBLIC_).
  const type = key.startsWith("NEXT_PUBLIC_") || !SECRET_KEYS.has(key) ? "config" : "secret";
  // Pass value via stdin so Windows cmd does not choke on <email@...> style values.
  const args = [
    "vercel@latest",
    "env",
    "add",
    key,
    environment,
    "--type",
    type,
    "--force",
    "--yes",
  ];

  const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    input: `${value}\n`,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    // Never echo command output that might contain the value.
    throw new Error(`Failed to set ${key} (${environment}): exit ${result.status}${err ? ` (${err.split("\n").slice(-2).join(" | ")})` : ""}`);
  }
}

const local = parseEnvFile(envPath);
const missing = REQUIRED.filter((key) => !local[key]);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}

const values = { ...OPTIONAL_DEFAULTS, ...local };
if (!values.NEXT_PUBLIC_APP_URL || values.NEXT_PUBLIC_APP_URL.includes("localhost")) {
  // Will be patched after first deploy URL is known.
  delete values.NEXT_PUBLIC_APP_URL;
  console.warn("Skipping NEXT_PUBLIC_APP_URL until production URL is known.");
}

const targets = ["production", "preview"];
const keys = [
  ...new Set([
    ...REQUIRED,
    ...Object.keys(OPTIONAL_DEFAULTS),
    "EMAIL_FROM",
    "RESEND_API_KEY",
    ...(values.NEXT_PUBLIC_APP_URL ? ["NEXT_PUBLIC_APP_URL"] : []),
  ]),
].filter((key) => values[key] != null && String(values[key]).length > 0);

console.log(`Syncing ${keys.length} env vars to Vercel (${targets.join(", ")}) ...`);
for (const key of keys) {
  for (const environment of targets) {
    process.stdout.write(`  ${key} → ${environment} ... `);
    try {
      vercelEnvAdd(key, String(values[key]), environment);
      console.log("ok");
    } catch (err) {
      console.log("fail");
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
}
console.log("Done.");
