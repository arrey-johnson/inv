import type { ReactNode } from "react";
import type { UserRole } from "@/types/database";
import { Header, type HeaderUser } from "./header";
import { RoutePrefetcher } from "./route-prefetcher";
import { Sidebar } from "./sidebar";

interface AppShellProps {
  user: HeaderUser;
  role: UserRole;
  organizationName: string;
  /** DEMO_MODE: data lives in a local file, there is no sign-in. */
  demo?: boolean;
  children: ReactNode;
}

/** Authenticated application frame: fixed sidebar (desktop), sticky header, scrolling content. */
export function AppShell({ user, role, organizationName, demo = false, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <RoutePrefetcher />
      <Sidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} organizationName={organizationName} />
        {demo && (
          <div role="status" className="border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning lg:px-8">
            DEMO MODE - data is stored locally in <code className="font-mono">.data/</code>. Nothing here is sent to Supabase.
          </div>
        )}
        <main id="main-content" className="flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
