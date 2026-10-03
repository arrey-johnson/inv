"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, isFailure } from "@/lib/actions/helpers";
import { companyProfileSchema } from "@/lib/validations/organization";

export type UpdateCompanyResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function updateCompanyProfileAction(input: unknown): Promise<UpdateCompanyResult> {
  const auth = await authorize("settings.company.manage");
  if (isFailure(auth)) return { ok: false, error: auth.error };

  const parsed = companyProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const before = await auth.repo.organization.get();
    const after = await auth.repo.organization.update(parsed.data);
    await auth.repo.writeAudit({
      action: "settings.company.update",
      entityType: "organization",
      entityId: after.id,
      before: before ? { ...before } : null,
      after: { ...after },
    });
  } catch (error) {
    return { ok: false, error: failure(error).error };
  }

  revalidatePath("/settings/company");
  revalidatePath("/", "layout");
  return { ok: true };
}
