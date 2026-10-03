"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { NAV_GROUPS, SETTINGS_NAV } from "./nav-config";

/** Extra builder / form routes that are clicked often but sit outside the sidebar. */
const HOT_ROUTES = [
  "/sales/customers/new",
  "/sales/items/new",
  "/sales/proformas/new",
  "/sales/invoices/new",
  "/sales/advances/new",
  "/sales/credit-notes/new",
  "/sales/payments/new",
] as const;

function collectHrefs(): string[] {
  const nav = [
    ...NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href)),
    ...SETTINGS_NAV.map((item) => item.href),
    ...HOT_ROUTES,
  ];
  return [...new Set(nav)];
}

/**
 * After the shell paints, fully prefetch primary routes in idle time.
 * In `next dev` this also warms the compiler so the first click is not a compile wait.
 */
export function RoutePrefetcher() {
  const router = useRouter();

  useEffect(() => {
    const hrefs = collectHrefs();
    let index = 0;
    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const prefetchNext = () => {
      if (cancelled || index >= hrefs.length) return;
      router.prefetch(hrefs[index++]);
      schedule();
    };

    const schedule = () => {
      if (cancelled || index >= hrefs.length) return;
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(prefetchNext, { timeout: 1200 });
      } else {
        timeoutId = setTimeout(prefetchNext, 40);
      }
    };

    // Let the current page finish first-paint before warming the rest.
    timeoutId = setTimeout(schedule, 150);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (idleId !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [router]);

  return null;
}
