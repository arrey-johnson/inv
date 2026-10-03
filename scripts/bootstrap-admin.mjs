/**
 * Create the first ADMIN user for Promptstack and attach profile + role.
 *
 * Usage:
 *   node scripts/bootstrap-admin.mjs --email you@example.com --password "StrongPass123!" --name "Your Name"
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const p = path.resolve(".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && argv[i + 1]) {
      out[argv[i].slice(2)] = argv[++i];
    }
  }
  return out;
}

loadEnvLocal();
const args = parseArgs(process.argv.slice(2));
const email = args.email;
const password = args.password;
const fullName = args.name || "Promptstack Owner";
const orgId =
  process.env.DEFAULT_ORGANIZATION_ID || "00000000-0000-4000-8000-000000000001";

if (!email || !password) {
  console.error(
    'Usage: node scripts/bootstrap-admin.mjs --email you@example.com --password "StrongPass123!" [--name "Your Name"]',
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});

let userId = created?.user?.id;
if (createErr) {
  if (String(createErr.message).toLowerCase().includes("already")) {
    const { data: listed, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) {
      console.error(listErr);
      process.exit(1);
    }
    const existing = listed.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (!existing) {
      console.error(createErr);
      process.exit(1);
    }
    userId = existing.id;
    console.log("User already exists, attaching role:", userId);
  } else {
    console.error(createErr);
    process.exit(1);
  }
} else {
  console.log("Created auth user:", userId);
}

const { error: profileErr } = await admin.from("profiles").upsert({
  id: userId,
  organization_id: orgId,
  full_name: fullName,
  email,
  is_active: true,
});
if (profileErr) {
  console.error("profile upsert failed:", profileErr);
  process.exit(1);
}

const { data: existingRole } = await admin
  .from("user_roles")
  .select("id, role")
  .eq("user_id", userId)
  .eq("organization_id", orgId)
  .maybeSingle();

if (!existingRole) {
  const { error: roleErr } = await admin.from("user_roles").insert({
    user_id: userId,
    organization_id: orgId,
    role: "admin",
  });
  if (roleErr) {
    console.error("role insert failed:", roleErr);
    process.exit(1);
  }
  console.log("Assigned ADMIN role.");
} else {
  console.log("Role already present:", existingRole.role);
}

// Register branding asset rows if missing
const assets = [
  {
    kind: "letterhead",
    storage_path: `${orgId}/branding/letterhead.pdf`,
    file_name: "letterhead.pdf",
    mime_type: "application/pdf",
    byte_size: 45652,
  },
  {
    kind: "stamp",
    storage_path: `${orgId}/branding/company-stamp.png`,
    file_name: "company-stamp.png",
    mime_type: "image/png",
    byte_size: 268228,
  },
];

for (const a of assets) {
  const { data: existing } = await admin
    .from("brand_assets")
    .select("id")
    .eq("organization_id", orgId)
    .eq("kind", a.kind)
    .eq("is_active", true)
    .maybeSingle();
  if (existing) {
    console.log("brand asset already registered:", a.kind);
    continue;
  }
  const { error } = await admin.from("brand_assets").insert({
    organization_id: orgId,
    kind: a.kind,
    storage_bucket: "branding",
    storage_path: a.storage_path,
    file_name: a.file_name,
    mime_type: a.mime_type,
    byte_size: a.byte_size,
    version: 1,
    is_active: true,
  });
  if (error) console.error("brand_assets insert", a.kind, error);
  else console.log("Registered brand asset:", a.kind);
}

console.log("\nDone. Sign in at /login with:");
console.log("  email:", email);
console.log("  password: (the one you provided)");
