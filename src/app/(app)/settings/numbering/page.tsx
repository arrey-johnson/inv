import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { SequenceCard } from "./sequence-card";

export const metadata: Metadata = { title: "Numbering settings" };

const TYPE_LABELS = {
  invoice: "Invoice",
  proforma: "Proforma",
  credit_note: "Credit note",
  receipt: "Receipt",
  advance: "Advance",
} as const;

export default async function NumberingSettingsPage() {
  const { ctx, repo } = await requirePageRepo("settings.view");
  const year = new Date().getFullYear();
  const { sequences, counters } = await repo.sequences.list();
  const canEdit = hasPermission(ctx.role, "settings.numbering.manage");

  return (
    <>
      <PageHeader
        title="Numbering"
        description="Document numbers are allocated at issue time: unique, sequential and concurrency-safe. Drafts have no number."
      />
      <Alert>
        <AlertDescription>
          Changing a prefix only affects documents issued from now on. Once a number has been issued for a type, the
          year and yearly-reset options are locked so a number can never repeat.
        </AlertDescription>
      </Alert>

      {sequences.length === 0 && <p className="text-sm text-muted-foreground">No sequences configured. Run the seed migration.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {[...sequences]
          .sort((a, b) => a.document_type.localeCompare(b.document_type))
          .map((seq) => {
            const last =
              counters.find((c) => c.document_type === seq.document_type && c.sequence_year === (seq.reset_yearly ? year : 0))
                ?.last_number ?? 0;
            return (
              <SequenceCard
                key={`${seq.id}-${seq.updated_at}`}
                title={TYPE_LABELS[seq.document_type]}
                lastNumber={last}
                year={year}
                canEdit={canEdit}
                defaultValues={{
                  documentType: seq.document_type,
                  prefix: seq.prefix,
                  separator: seq.separator,
                  include_year: seq.include_year,
                  reset_yearly: seq.reset_yearly,
                  padding: String(seq.padding),
                  start_number: String(seq.start_number),
                }}
              />
            );
          })}
      </div>
    </>
  );
}
