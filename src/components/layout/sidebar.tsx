"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PromptstackLogo } from "@/components/brand/promptstack-logo";
import { hasPermission } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/database";
import { NAV_GROUPS, SETTINGS_NAV, SETTINGS_ROOT, type NavItem } from "./nav-config";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  pathname,
  onNavigate,
  activeOverride,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
  activeOverride?: boolean;
}) {
  const active = activeOverride ?? isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "text-sidebar-foreground/60")} />
      <span className="truncate">{item.title}</span>
    </Link>
  );
}

/** Navigation list shared by the desktop sidebar and the mobile sheet. */
export function SidebarNav({ role, onNavigate }: { role: UserRole; onNavigate?: () => void }) {
  const pathname = usePathname();

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasPermission(role, item.permission)),
  })).filter((group) => group.items.length > 0);

  const settingsItems = SETTINGS_NAV.filter((item) => hasPermission(role, item.permission));
  const settingsActive = pathname.startsWith("/settings");

  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
            {group.label}
          </p>
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </div>
      ))}

      {settingsItems.length > 0 && (
        <div className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
            Administration
          </p>
          <NavLink
            item={{ ...SETTINGS_ROOT, href: settingsItems[0].href }}
            pathname={pathname}
            activeOverride={settingsActive}
            onNavigate={onNavigate}
          />
          {settingsActive && (
            <div className="ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
              {settingsItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  onClick={onNavigate}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-md px-3 py-1.5 text-[13px] transition-colors",
                    isActive(pathname, item.href)
                      ? "bg-sidebar-accent/70 font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/65 hover:text-sidebar-accent-foreground",
                  )}
                >
                  {item.title}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <Link
      href="/dashboard"
      prefetch
      className="flex items-center border-b border-sidebar-border px-4 py-4"
      aria-label="Promptstack Technologies — Dashboard"
    >
      <PromptstackLogo variant="white" className="h-9 w-auto max-w-[200px]" />
    </Link>
  );
}

/** Fixed desktop sidebar (hidden below `lg`; the header provides a sheet on small screens). */
export function Sidebar({ role }: { role: UserRole }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <SidebarBrand />
      <SidebarNav role={role} />
      <p className="px-5 py-4 text-[11px] text-sidebar-foreground/40">Promptstack Technologies</p>
    </aside>
  );
}
