import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/session";
import { REPORT_IDS, REPORT_META } from "@/lib/reports/types";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requirePermission("reports.view");

  return (
    <>
      <PageHeader
        title="Reports"
        description="Sales, receivables, VAT and numbering reports. Every report can be exported to CSV or Excel."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORT_IDS.map((id) => (
          <Link key={id} href={`/reports/${id}`} className="group">
            <Card className="h-full transition-colors group-hover:border-primary">
              <CardHeader>
                <CardTitle className="text-base">{REPORT_META[id].title}</CardTitle>
                <CardDescription>{REPORT_META[id].description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
