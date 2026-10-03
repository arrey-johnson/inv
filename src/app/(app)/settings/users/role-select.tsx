"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { USER_ROLES, type UserRole } from "@/types/database";
import { setMemberRoleAction } from "./actions";

export function RoleSelect({ userId, role, disabled }: { userId: string; role: UserRole; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<UserRole>(role);

  return (
    <NativeSelect
      aria-label="Role"
      className="w-40"
      value={value}
      disabled={disabled || pending}
      onChange={(e) => {
        const next = e.target.value as UserRole;
        const previous = value;
        setValue(next);
        startTransition(async () => {
          const result = await setMemberRoleAction({ userId, role: next });
          if (!result.ok) {
            setValue(previous);
            toast.error(result.error);
            return;
          }
          toast.success(`Role changed to ${ROLE_LABELS[next]}`);
          router.refresh();
        });
      }}
    >
      {USER_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </NativeSelect>
  );
}
