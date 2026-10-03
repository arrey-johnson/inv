/**
 * Hit primary app routes so `next dev` compiles them ahead of the first click.
 * Usage: node scripts/warm-routes.mjs [baseUrl]
 */
const base = (process.argv[2] || process.env.APP_URL || "http://localhost:3001").replace(/\/$/, "");

const routes = [
  "/dashboard",
  "/sales/customers",
  "/sales/customers/new",
  "/sales/items",
  "/sales/items/new",
  "/sales/proformas",
  "/sales/proformas/new",
  "/sales/invoices",
  "/sales/invoices/new",
  "/sales/advances",
  "/sales/advances/new",
  "/sales/credit-notes",
  "/sales/credit-notes/new",
  "/sales/payments",
  "/sales/payments/new",
  "/reports",
  "/settings/company",
  "/settings/tax",
  "/settings/payment-methods",
  "/settings/branding",
  "/settings/users",
  "/settings/numbering",
  "/settings/invoice-defaults",
];

async function waitForServer(ms = 90_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${base}/api/health`, { cache: "no-store" });
      if (res.ok || res.status === 401 || res.status === 404) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${base} did not become ready`);
}

async function warm() {
  console.log(`[warm] waiting for ${base} ...`);
  await waitForServer();
  console.log(`[warm] compiling ${routes.length} routes ...`);
  for (const path of routes) {
    const url = `${base}${path}`;
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "x-warm-routes": "1" },
        redirect: "manual",
      });
      console.log(`[warm] ${res.status} ${path} (${Date.now() - t0}ms)`);
    } catch (err) {
      console.warn(`[warm] fail ${path}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log("[warm] done");
}

warm().catch((err) => {
  console.error(err);
  process.exit(1);
});
