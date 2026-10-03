import "server-only";
import type { Repository } from "@/lib/data/types";
import { buildIssuerSnapshot } from "@/lib/documents/snapshots";
import { ServiceError } from "@/lib/documents/service-support";
import { partyFromSnapshot } from "@/lib/pdf/map-document";
import { loadBrandingAssets } from "@/lib/storage/branding";
import type { CurrencyCode } from "@/lib/finance/money";
import { todayISO } from "@/lib/utils/date-math";
import { loadCustomerStatement } from "./statement-service";
import { renderStatementPdf } from "./statement-pdf";

export async function renderCustomerStatementPdf(
  repo: Repository,
  customerId: string,
  range: { from: string; to: string },
  currency?: CurrencyCode,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const { customer, statement } = await loadCustomerStatement(repo, customerId, range, currency);
  const [organization, settings, destinations] = await Promise.all([
    repo.organization.get(),
    repo.organization.getSettings(),
    repo.paymentDestinations.list(),
  ]);
  if (!organization) throw new ServiceError("Organization not found.", "not_found");

  const branding = await loadBrandingAssets(organization.id);
  const issuer = partyFromSnapshot(buildIssuerSnapshot(organization, settings, destinations), "Promptstack Technologies");
  const bytes = await renderStatementPdf(
    {
      statement,
      customer: partyFromSnapshot({ ...customer }, customer.name),
      issuer,
      generatedOn: todayISO(),
    },
    { letterheadPdf: branding.letterheadPdf },
  );
  const safe = customer.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "customer";
  return { bytes, filename: `statement-${safe}-${range.from}-to-${range.to}.pdf` };
}
