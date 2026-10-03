"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, invalidInput, isFailure, succeed, type ActionResult } from "@/lib/actions/helpers";
import { sequenceSchema } from "@/lib/validations/settings";

export async function updateSequenceAction(input: unknown): Promise<ActionResult> {
  const auth = await authorize("settings.numbering.manage");
  if (isFailure(auth)) return auth;
  const parsed = sequenceSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { documentType, ...values } = parsed.data;

  try {
    const { sequences, counters } = await auth.repo.sequences.list();
    const current = sequences.find((s) => s.document_type === documentType);
    if (!current) return { ok: false, error: "Sequence not found." };

    // Once numbers exist for this type, the year/reset policy is frozen: changing it could repeat a number.
    const issued = counters.some((c) => c.document_type === documentType && c.last_number > 0);
    if (issued && (current.reset_yearly !== values.reset_yearly || current.include_year !== values.include_year)) {
      return {
        ok: false,
        error: "Numbers were already issued for this document type, so the year / yearly reset options can no longer change.",
        fieldErrors: { reset_yearly: "Locked after the first issued number" },
      };
    }

    const updated = await auth.repo.sequences.update(documentType, values);
    await auth.repo.writeAudit({
      action: "settings.numbering.update",
      entityType: "document_sequence",
      entityId: updated.id,
      before: { ...current },
      after: { ...updated },
    });
    revalidatePath("/settings/numbering");
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}
