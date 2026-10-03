import {
  BarChart3,
  Building2,
  CreditCard,
  FileMinus2,
  FileText,
  FileSpreadsheet,
  Hash,
  LayoutDashboard,
  Package,
  Palette,
  Percent,
  PiggyBank,
  Settings,
  SlidersHorizontal,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/auth/rbac";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Item is shown only when the user's role has this permission. */
  permission: Permission;
  description?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Information architecture of the app. Keep the folder structure under src/app/(app) in sync. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
    ],
  },
  {
    label: "Sales",
    items: [
      { title: "Customers", href: "/sales/customers", icon: UsersRound, permission: "customers.view" },
      { title: "Items", href: "/sales/items", icon: Package, permission: "items.view" },
      { title: "Proformas", href: "/sales/proformas", icon: FileSpreadsheet, permission: "proformas.view" },
      { title: "Invoices", href: "/sales/invoices", icon: FileText, permission: "invoices.view" },
      { title: "Advances", href: "/sales/advances", icon: PiggyBank, permission: "invoices.view" },
      { title: "Credit notes", href: "/sales/credit-notes", icon: FileMinus2, permission: "credit_notes.view" },
      { title: "Payments", href: "/sales/payments", icon: Wallet, permission: "payments.view" },
    ],
  },
  {
    label: "Insights",
    items: [{ title: "Reports", href: "/reports", icon: BarChart3, permission: "reports.view" }],
  },
];

/** Settings sub-navigation (rendered in the sidebar and as tabs inside /settings). */
export const SETTINGS_NAV: NavItem[] = [
  { title: "Company", href: "/settings/company", icon: Building2, permission: "settings.view", description: "Legal identity and contact details" },
  { title: "Tax", href: "/settings/tax", icon: Percent, permission: "settings.view", description: "VAT rates and withholding types" },
  { title: "Payment methods", href: "/settings/payment-methods", icon: CreditCard, permission: "settings.view", description: "Bank, mobile money and accepted methods" },
  { title: "Branding", href: "/settings/branding", icon: Palette, permission: "settings.view", description: "Letterhead and company stamp" },
  { title: "Users", href: "/settings/users", icon: Users, permission: "settings.users.manage", description: "Team members and roles" },
  { title: "Numbering", href: "/settings/numbering", icon: Hash, permission: "settings.view", description: "Document number sequences" },
  { title: "Invoice defaults", href: "/settings/invoice-defaults", icon: SlidersHorizontal, permission: "settings.view", description: "Terms, notes and due dates" },
];

export const SETTINGS_ROOT: NavItem = {
  title: "Settings",
  href: "/settings/company",
  icon: Settings,
  permission: "settings.view",
};

/** Resolve a human title for a pathname (used by the header). */
export function getPageTitle(pathname: string): string {
  const all: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), ...SETTINGS_NAV];
  const exact = all.find((item) => item.href === pathname);
  if (exact) return exact.title;
  const prefix = all
    .filter((item) => pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return prefix?.title ?? "Promptstack Invoicing";
}
