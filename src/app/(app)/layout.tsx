import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requireAuth } from "@/lib/auth/session";
import { getRepositoryFor } from "@/lib/data";
import { isDemoMode } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAuth();

  const repo = await getRepositoryFor(ctx);
  const org = await repo.organization.get().catch(() => null);

  const email = ctx.user.email ?? "";
  const name = ctx.profile?.full_name?.trim() || (ctx.user.user_metadata?.full_name as string | undefined) || email.split("@")[0] || "User";

  return (
    <AppShell
      user={{ name, email, role: ctx.role }}
      role={ctx.role}
      organizationName={org?.trade_name || org?.legal_name || "Promptstack Technologies"}
      demo={isDemoMode()}
    >
      {children}
    </AppShell>
  );
}
