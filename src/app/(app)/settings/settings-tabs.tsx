"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_NAV } from "@/components/layout/nav-config";
import { hasPermission } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/database";

/** Horizontal section switcher shown on every settings page (mirrors the sidebar sub-nav). */
export function SettingsTabs({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = SETTINGS_NAV.filter((item) => hasPermission(role, item.permission));

  return (
    <nav aria-label="Settings sections" className="-mx-1 flex gap-1 overflow-x-auto border-b pb-px">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
