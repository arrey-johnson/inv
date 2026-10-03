"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, failure, invalidInput, isFailure, succeed, type ActionResult } from "@/lib/actions/helpers";
import { customerSchema } from "@/lib/validations/customer";
import type { CustomerWrite } from "@/lib/data/types";

function toWrite(values: z.output<typeof customerSchema>): CustomerWrite {
  return { ...values, default_withholding_type_id: null };
}

export async function createCustomerAction(
  input: unknown,
): Promise<
  ActionResult<{
    id: string;
    customer: {
      id: string;
      name: string;
      niu: string | null;
      customer_type: z.output<typeof customerSchema>["customer_type"];
      payment_terms_days: number | null;
      default_currency: z.output<typeof customerSchema>["default_currency"];
      is_active: boolean;
    };
  }>
> {
  const auth = await authorize("customers.create");
  if (isFailure(auth)) return auth;
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const customer = await auth.repo.customers.create(toWrite(parsed.data));
    await auth.repo.writeAudit({
      action: "customer.create",
      entityType: "customer",
      entityId: customer.id,
      after: { ...customer },
    });
    revalidatePath("/sales/customers");
    revalidatePath("/sales/invoices");
    revalidatePath("/sales/proformas");
    return succeed({
      id: customer.id,
      customer: {
        id: customer.id,
        name: customer.name,
        niu: customer.niu,
        customer_type: customer.customer_type,
        payment_terms_days: customer.payment_terms_days,
        default_currency: customer.default_currency,
        is_active: customer.is_active,
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function updateCustomerAction(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("customers.update");
  if (isFailure(auth)) return auth;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid customer." };
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const before = await auth.repo.customers.get(id);
    if (!before) return { ok: false, error: "Customer not found." };
    const customer = await auth.repo.customers.update(id, {
      ...toWrite(parsed.data),
      default_withholding_type_id: before.default_withholding_type_id,
    });
    await auth.repo.writeAudit({
      action: "customer.update",
      entityType: "customer",
      entityId: id,
      before: { ...before },
      after: { ...customer },
    });
    revalidatePath("/sales/customers", "layout");
    return succeed({ id });
  } catch (error) {
    return failure(error);
  }
}

export async function setCustomerActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const auth = await authorize("customers.update");
  if (isFailure(auth)) return auth;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid customer." };

  try {
    await auth.repo.customers.setActive(id, active);
    await auth.repo.writeAudit({
      action: active ? "customer.update" : "customer.deactivate",
      entityType: "customer",
      entityId: id,
      metadata: { is_active: active },
    });
    revalidatePath("/sales/customers", "layout");
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}
