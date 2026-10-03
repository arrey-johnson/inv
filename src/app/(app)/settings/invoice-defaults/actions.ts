"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, invalidInput, isFailure, succeed, type ActionResult } from "@/lib/actions/helpers";
import { invoiceDefaultsSchema } from "@/lib/validations/settings";

export async function updateInvoiceDefaultsAction(input: unknown): Promise<ActionResult> {
  const auth = await authorize("settings.invoice_defaults.manage");
  if (isFailure(auth)) return auth;
  const parsed = invoiceDefaultsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const before = await auth.repo.organization.getSettings();
    const after = await auth.repo.organization.updateSettings(parsed.data);
    await auth.repo.writeAudit({
      action: "settings.invoice_defaults.update",
      entityType: "organization_settings",
      before: before ? { ...before } : null,
      after: { ...after },
    });
    revalidatePath("/settings/invoice-defaults");
    revalidatePath("/sales", "layout");
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}
