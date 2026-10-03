"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, failure, invalidInput, isFailure, succeed, type ActionResult } from "@/lib/actions/helpers";
import { taxRateSchema, vatSettingsSchema } from "@/lib/validations/settings";

function refresh(): void {
  revalidatePath("/settings/tax");
  revalidatePath("/sales", "layout");
}

export async function setVatRegisteredAction(input: unknown): Promise<ActionResult> {
  const auth = await authorize("settings.tax.manage");
  if (isFailure(auth)) return auth;
  const parsed = vatSettingsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const before = await auth.repo.organization.getSettings();
    const after = await auth.repo.organization.updateSettings({ vat_registered: parsed.data.vat_registered });
    await auth.repo.writeAudit({
      action: "settings.tax.update",
      entityType: "organization_settings",
      before: { vat_registered: before?.vat_registered ?? null },
      after: { vat_registered: after.vat_registered },
    });
    refresh();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}

export async function createTaxRateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("settings.tax.manage");
  if (isFailure(auth)) return auth;
  const parsed = taxRateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const rate = await auth.repo.taxes.createRate({ ...parsed.data, is_active: parsed.data.is_active ?? true });
    await auth.repo.writeAudit({
      action: "settings.tax.update",
      entityType: "tax_rate",
      entityId: rate.id,
      after: { ...rate },
    });
    refresh();
    return succeed({ id: rate.id });
  } catch (error) {
    return failure(error);
  }
}

const rateIdSchema = z.string().uuid();

export async function setTaxRateActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const auth = await authorize("settings.tax.manage");
  if (isFailure(auth)) return auth;
  if (!rateIdSchema.safeParse(id).success) return { ok: false, error: "Invalid tax rate." };

  try {
    const rate = await auth.repo.taxes.updateRate(id, { is_active: active });
    await auth.repo.writeAudit({
      action: "settings.tax.update",
      entityType: "tax_rate",
      entityId: id,
      after: { is_active: rate.is_active },
    });
    refresh();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}

export async function setDefaultTaxRateAction(id: string): Promise<ActionResult> {
  const auth = await authorize("settings.tax.manage");
  if (isFailure(auth)) return auth;
  if (!rateIdSchema.safeParse(id).success) return { ok: false, error: "Invalid tax rate." };

  try {
    await auth.repo.taxes.setDefaultRate(id);
    await auth.repo.writeAudit({
      action: "settings.tax.update",
      entityType: "tax_rate",
      entityId: id,
      metadata: { default: true },
    });
    refresh();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}


const withholdingSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Enter a short code (e.g. WHT_A).")
    .max(20, "The code is too long.")
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, - and _ only.")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2, "Enter a name.").max(80),
  rate: z.coerce.number({ message: "Enter the rate as a number." }).gt(0, "The rate must be greater than 0.").lte(100, "The rate cannot exceed 100."),
  base: z.enum(["net_ht", "total_ttc"]),
  description: z.string().trim().max(300).optional().nullable(),
});

export async function createWithholdingAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("settings.tax.manage");
  if (isFailure(auth)) return auth;
  const parsed = withholdingSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const existing = await auth.repo.taxes.listWithholdings();
    if (existing.some((w) => w.code === parsed.data.code)) return { ok: false, error: `The code ${parsed.data.code} already exists.` };
    const created = await auth.repo.taxes.createWithholding({
      code: parsed.data.code,
      name: parsed.data.name,
      rate: parsed.data.rate,
      base: parsed.data.base,
      description: parsed.data.description || null,
      is_active: true,
    });
    await auth.repo.writeAudit({
      action: "settings.withholding.update",
      entityType: "withholding_type",
      entityId: created.id,
      after: { ...created },
    });
    refresh();
    return succeed({ id: created.id });
  } catch (error) {
    return failure(error);
  }
}

export async function setWithholdingActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const auth = await authorize("settings.tax.manage");
  if (isFailure(auth)) return auth;
  if (!rateIdSchema.safeParse(id).success) return { ok: false, error: "Invalid withholding type." };
  try {
    const updated = await auth.repo.taxes.updateWithholding(id, { is_active: active });
    await auth.repo.writeAudit({
      action: "settings.withholding.update",
      entityType: "withholding_type",
      entityId: id,
      after: { is_active: updated.is_active },
    });
    refresh();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}
