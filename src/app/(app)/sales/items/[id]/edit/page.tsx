import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemForm } from "@/components/items/item-form";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageRepo } from "@/lib/data/page";
import { taxRateOptions } from "@/lib/catalog/tax-options";

export const metadata: Metadata = { title: "Edit item" };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo } = await requirePageRepo("items.update");
  const [item, rates] = await Promise.all([repo.items.get(id), repo.taxes.listRates()]);
  if (!item) notFound();

  return (
    <>
      <PageHeader title={`Edit ${item.name}`} description="Price changes affect new documents only." />
      <ItemForm
        itemId={item.id}
        defaultValues={{
          item_type: item.item_type,
          sku: item.sku ?? "",
          name: item.name,
          description: item.description ?? "",
          unit: item.unit ?? "",
          unit_price: String(item.unit_price),
          currency: item.currency,
          tax_rate_id: item.tax_rate_id,
          is_active: item.is_active,
        }}
        taxRateOptions={taxRateOptions(rates)}
      />
    </>
  );
}
