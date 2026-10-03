"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, invalidInput, isFailure, succeed, type ActionResult } from "@/lib/actions/helpers";
import { memberRoleSchema } from "@/lib/validations/settings";

export async function setMemberRoleAction(input: unknown): Promise<ActionResult> {
  const auth = await authorize("settings.users.manage");
  if (isFailure(auth)) return auth;
  const parsed = memberRoleSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    const members = await auth.repo.team.listMembers();
    const current = members.find((m) => m.userId === parsed.data.userId);
    if (!current) return { ok: false, error: "That user is not a member of this organization." };
    if (current.role === parsed.data.role) return succeed(null);

    await auth.repo.team.setRole(parsed.data.userId, parsed.data.role);
    await auth.repo.writeAudit({
      action: "user.role_change",
      entityType: "user_role",
      entityId: parsed.data.userId,
      before: { role: current.role },
      after: { role: parsed.data.role },
    });
    revalidatePath("/settings/users");
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}
