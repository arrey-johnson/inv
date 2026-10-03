"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, failure, invalidInput, isFailure, succeed, type ActionResult } from "@/lib/actions/helpers";
import { starterCatalogWrites } from "@/lib/catalog/starter-catalog";
import { D } from "@/lib/finance/money";
import type { ItemWrite } from "@/lib/data/types";
import { itemSchema } from "@/lib/validations/item";

function toWrite(values: z.output<typeof itemSchema>): ItemWrite {
  return {
    item_type: values.item_type,
    sku: values.sku,
    name: values.name,
    description: values.description,
    unit: values.unit,
    unit_price: new D(values.unit_price).toDecimalPlaces(4).toNumber(),
    currency: values.currency,
    tax_rate_id: values.tax_rate_id,
    is_active: values.is_active,
  };
}

export async function createItemAction(
  input: unknown,
): Promise<
  ActionResult<{
    id: string;
    item: {
      id: string;
      sku: string | null;
      name: string;
      description: string | null;
      unit: string | null;
      unit_price: string;
      currency: z.output<typeof itemSchema>["currency"];
      tax_rate_id: string | null;
    };
  }>
> {
  const auth = await authorize("items.create");
  if (isFailure(auth)) return auth;
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const item = await auth.repo.items.create(toWrite(parsed.data));
    await auth.repo.writeAudit({ action: "item.create", entityType: "item", entityId: item.id, after: { ...item } });
    revalidatePath("/sales/items");
    revalidatePath("/sales/invoices");
    revalidatePath("/sales/proformas");
    return succeed({
      id: item.id,
      item: {
        id: item.id,
        sku: item.sku,
        name: item.name,
        description: item.description,
        unit: item.unit,
        unit_price: String(item.unit_price),
        currency: item.currency,
        tax_rate_id: item.tax_rate_id,
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function updateItemAction(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("items.update");
  if (isFailure(auth)) return auth;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid item." };
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const before = await auth.repo.items.get(id);
    if (!before) return { ok: false, error: "Item not found." };
    const item = await auth.repo.items.update(id, toWrite(parsed.data));
    await auth.repo.writeAudit({
      action: "item.update",
      entityType: "item",
      entityId: id,
      before: { ...before },
      after: { ...item },
    });
    revalidatePath("/sales/items");
    return succeed({ id });
  } catch (error) {
    return failure(error);
  }
}

/** Adds the nine Promptstack services that do not exist yet (matched by SKU). Prices start at 0. */
export async function seedStarterCatalogAction(): Promise<ActionResult<{ created: number }>> {
  const auth = await authorize("items.create");
  if (isFailure(auth)) return auth;

  try {
    const [rates, settings] = await Promise.all([auth.repo.taxes.listRates(), auth.repo.organization.getSettings()]);
    const defaultRate = rates.find((r) => r.id === settings?.default_tax_rate_id) ?? rates.find((r) => r.is_default) ?? null;
    const created = await auth.repo.items.createManyIfMissing(
      starterCatalogWrites({
        withDemoPrices: false,
        taxRateId: settings?.vat_registered === false ? null : (defaultRate?.id ?? null),
        currency: settings?.default_currency,
      }),
    );
    await auth.repo.writeAudit({ action: "item.seed_catalog", entityType: "item", metadata: { created } });
    revalidatePath("/sales/items");
    return succeed({ created });
  } catch (error) {
    return failure(error);
  }
}
