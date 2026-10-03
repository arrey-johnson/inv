import pg from "pg";

const pw = process.env.SUPABASE_DB_PASSWORD || process.argv[2];
const ref = "iweekwnmkcmlxiwswrav";
const urls = [
  `postgresql://postgres.${ref}:${encodeURIComponent(pw)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encodeURIComponent(pw)}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${ref}:${encodeURIComponent(pw)}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encodeURIComponent(pw)}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encodeURIComponent(pw)}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres:${encodeURIComponent(pw)}@db.${ref}.supabase.co:5432/postgres`,
  `postgresql://postgres:${encodeURIComponent(pw)}@[2a05:d018:48a:c900:bf4e:3e97:76b3:aeae]:5432/postgres`,
];

for (const url of urls) {
  const masked = url.replace(/:[^:@/]+@/, ":***@");
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    const r = await client.query(
      "select current_database() as db, current_user as usr, inet_server_addr()::text as addr",
    );
    console.log("OK", masked);
    console.log(JSON.stringify(r.rows[0]));
    await client.end();
    // Print working URL marker for the apply script
    console.log("WORKING_URL=" + url);
    process.exit(0);
  } catch (e) {
    console.log("FAIL", masked, "->", e.code || "", String(e.message).split("\n")[0]);
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}
process.exit(1);
