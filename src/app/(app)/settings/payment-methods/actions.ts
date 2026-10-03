"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, failure, invalidInput, isFailure, succeed, type ActionResult } from "@/lib/actions/helpers";
import { paymentDestinationSchema, paymentMethodsSchema } from "@/lib/validations/settings";

function refresh(): void {
  revalidatePath("/settings/payment-methods");
}

export async function updatePaymentMethodsAction(input: unknown): Promise<ActionResult> {
  const auth = await authorize("settings.payment_methods.manage");
  if (isFailure(auth)) return auth;
  const parsed = paymentMethodsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const before = await auth.repo.organization.getSettings();
    await auth.repo.organization.updateSettings({ enabled_payment_methods: parsed.data.enabled_payment_methods });
    await auth.repo.writeAudit({
      action: "settings.payment_methods.update",
      entityType: "organization_settings",
      before: { enabled_payment_methods: before?.enabled_payment_methods ?? [] },
      after: { enabled_payment_methods: parsed.data.enabled_payment_methods },
    });
    refresh();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}

export async function savePaymentDestinationAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("settings.payment_methods.manage");
  if (isFailure(auth)) return auth;
  if (id !== null && !z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid destination." };
  const parsed = paymentDestinationSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const values = {
    ...parsed.data,
    is_default: parsed.data.is_default ?? false,
    is_active: parsed.data.is_active ?? true,
    show_on_documents: parsed.data.show_on_documents ?? true,
  };
  if (values.kind === "bank" && !values.account_number && !values.iban) {
    return { ok: false, error: "Enter an account number or IBAN.", fieldErrors: { account_number: "Enter an account number or IBAN." } };
  }
  if (values.kind === "mobile_money" && !values.account_number) {
    return { ok: false, error: "Enter the mobile money number.", fieldErrors: { account_number: "Enter the mobile money number." } };
  }

  try {
    const saved = id ? await auth.repo.paymentDestinations.update(id, values) : await auth.repo.paymentDestinations.create(values);
    await auth.repo.writeAudit({
      action: "settings.payment_methods.update",
      entityType: "payment_destination",
      entityId: saved.id,
      after: { ...saved },
    });
    refresh();
    return succeed({ id: saved.id });
  } catch (error) {
    return failure(error);
  }
}

export async function deletePaymentDestinationAction(id: string): Promise<ActionResult> {
  const auth = await authorize("settings.payment_methods.manage");
  if (isFailure(auth)) return auth;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid destination." };

  try {
    await auth.repo.paymentDestinations.remove(id);
    await auth.repo.writeAudit({
      action: "settings.payment_methods.update",
      entityType: "payment_destination",
      entityId: id,
      metadata: { removed: true },
    });
    refresh();
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}
