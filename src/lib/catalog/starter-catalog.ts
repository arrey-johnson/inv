import type { CurrencyCode } from "@/lib/finance/money";
import type { ItemWrite } from "@/lib/data/types";

/**
 * Promptstack service catalog. Used by:
 *  - the "Load starter catalog" button on the Items page (prices left at 0: set your own),
 *  - the DEMO seed (clearly fictional sample prices so the UI can be exercised immediately).
 */
export interface StarterCatalogEntry {
  sku: string;
  name: string;
  description: string;
  itemType: "product" | "service";
  unit: string;
  /** Sample price used ONLY in demo mode. */
  demoPrice: number;
}

export const STARTER_CATALOG: ReadonlyArray<StarterCatalogEntry> = [
  { sku: "WEB-DEV", name: "Website Development", description: "Design and development of a website.", itemType: "service", unit: "project", demoPrice: 1_000_000 },
  { sku: "SW-DEV", name: "Software Development", description: "Custom software design and development.", itemType: "service", unit: "project", demoPrice: 1_500_000 },
  { sku: "SW-MNT", name: "Software Maintenance", description: "Monthly maintenance and support of software.", itemType: "service", unit: "month", demoPrice: 150_000 },
  { sku: "DIG-MKT", name: "Digital Marketing", description: "Digital marketing and social media management.", itemType: "service", unit: "month", demoPrice: 200_000 },
  { sku: "CONSULT", name: "Consulting", description: "Technology consulting.", itemType: "service", unit: "hour", demoPrice: 25_000 },
  { sku: "AI-TRN", name: "AI Training", description: "Training session on artificial intelligence.", itemType: "service", unit: "session", demoPrice: 100_000 },
  { sku: "SWE-TRN", name: "Software Engineering Training", description: "Training session on software engineering.", itemType: "service", unit: "session", demoPrice: 150_000 },
  { sku: "DOM-HOST", name: "Domain / Hosting", description: "Domain name registration and web hosting.", itemType: "service", unit: "year", demoPrice: 50_000 },
  { sku: "SYS-MNT", name: "System Maintenance", description: "IT systems maintenance.", itemType: "service", unit: "month", demoPrice: 100_000 },
];

export function starterCatalogWrites(options: {
  withDemoPrices: boolean;
  taxRateId: string | null;
  currency?: CurrencyCode;
}): ItemWrite[] {
  return STARTER_CATALOG.map((entry) => ({
    item_type: entry.itemType,
    sku: entry.sku,
    name: entry.name,
    description: entry.description,
    unit: entry.unit,
    unit_price: options.withDemoPrices ? entry.demoPrice : 0,
    currency: options.currency ?? "XAF",
    tax_rate_id: options.taxRateId,
    is_active: true,
  }));
}
