import type { ReactNode } from "react";
import { requirePermission } from "@/lib/auth/session";
import { SettingsTabs } from "./settings-tabs";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePermission("settings.view");

  return (
    <div className="space-y-6">
      <SettingsTabs role={ctx.role} />
      {children}
    </div>
  );
}
