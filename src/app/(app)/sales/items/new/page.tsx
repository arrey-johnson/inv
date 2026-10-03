import type { Metadata } from "next";
import { ItemForm } from "@/components/items/item-form";
import { EMPTY_ITEM } from "@/lib/validations/item";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageRepo } from "@/lib/data/page";
import { taxRateOptions } from "@/lib/catalog/tax-options";

export const metadata: Metadata = { title: "New item" };

export default async function NewItemPage() {
  const { repo } = await requirePageRepo("items.create");
  const [settings, rates] = await Promise.all([repo.organization.getSettings(), repo.taxes.listRates()]);

  return (
    <>
      <PageHeader title="New product or service" description="Add it to the catalog so it can be picked on proformas and invoices." />
      <ItemForm
        defaultValues={{ ...EMPTY_ITEM, currency: settings?.default_currency ?? "XAF" }}
        taxRateOptions={taxRateOptions(rates)}
      />
    </>
  );
}
