/**
 * Apply supabase/migrations/*.sql to a remote Postgres (Supabase).
 *
 * Usage:
 *   set DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
 *   node scripts/apply-migrations.mjs
 *
 * Or:
 *   node scripts/apply-migrations.mjs --password "YOUR_DB_PASSWORD"
 *
 * Connection string formats (Project Settings → Database):
 *   Session mode:  postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres
 *   Direct:        postgresql://postgres:[PASSWORD]@db.[ref].supabase.co:5432/postgres
 */
import fs from "fs";
import path from "path";
import pg from "pg";

const PROJECT_REF = "iweekwnmkcmlxiwswrav";
const migrationsDir = path.resolve("supabase/migrations");

function parseArgs(argv) {
  const out = { password: process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD || "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--password" && argv[i + 1]) {
      out.password = argv[++i];
    }
    if (argv[i] === "--url" && argv[i + 1]) {
      out.url = argv[++i];
    }
  }
  return out;
}

function buildUrl(password) {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Prefer direct connection for DDL
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url || buildUrl(args.password);
  if (!args.url && !args.password && !process.env.DATABASE_URL) {
    console.error(
      "Missing database password.\n\n" +
        "Provide one of:\n" +
        "  1) node scripts/apply-migrations.mjs --password \"YOUR_DB_PASSWORD\"\n" +
        "  2) DATABASE_URL=postgresql://... node scripts/apply-migrations.mjs\n\n" +
        "Find the password in Supabase Dashboard → Project Settings → Database.",
    );
    process.exit(1);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.error("No migration files found in", migrationsDir);
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  console.log("Connecting...");
  await client.connect();
  console.log("Connected. Applying", files.length, "migrations.\n");

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  for (const file of files) {
    const { rows } = await client.query(
      "SELECT 1 FROM public.schema_migrations WHERE filename = $1",
      [file],
    );
    if (rows.length) {
      console.log("skip ", file, "(already applied)");
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    process.stdout.write(`apply ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO public.schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("OK");
    } catch (err) {
      await client.query("ROLLBACK");
      console.log("FAIL");
      console.error(err.message);
      await client.end();
      process.exit(1);
    }
  }

  // Quick sanity check
  const orgs = await client.query("SELECT id, legal_name FROM public.organizations LIMIT 5");
  console.log("\nOrganizations:", orgs.rows);

  await client.end();
  console.log("\nAll migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
