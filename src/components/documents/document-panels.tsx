import Link from "next/link";
import { PaymentMethodLabel } from "@/components/payments/payment-method-label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/finance/format";
import { formatDate } from "@/lib/utils";
import type { AdvanceLink, AuditLog, CreditNoteLink, DocumentRow, EmailLog, Payment, PaymentAllocation } from "@/types/database";

/** Tabs of a document page (`?tab=`). Each tab is server rendered, so they work without JavaScript. */
export function DocumentTabs({
  base,
  active,
  tabs,
}: {
  base: string;
  active: string;
  tabs: Array<{ id: string; title: string }>;
}) {
  return (
    <nav className="flex gap-1 border-b" aria-label="Document sections">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.id === "overview" ? base : `${base}?tab=${tab.id}`}
          aria-current={tab.id === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab.id === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.title}
        </Link>
      ))}
    </nav>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? "border-t pt-2 text-base font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** How the amount due is made up: total, withholding, advances, credits, payments, balance. */
export function SettlementSummary({ doc }: { doc: DocumentRow }) {
  const money = (n: number) => formatMoney(n, doc.currency);
  return (
    <dl className="w-full max-w-md space-y-1.5 text-sm">
      <Row label="Total TTC" value={money(doc.total_ttc)} />
      {doc.withholding_total > 0 && <Row label="Less withholding" value={`- ${money(doc.withholding_total)}`} muted />}
      {doc.withholding_total > 0 && <Row label="Net payable" value={money(doc.net_payable)} />}
      {doc.advance_applied_amount > 0 && <Row label="Advances deducted" value={`- ${money(doc.advance_applied_amount)}`} muted />}
      {doc.credited_amount > 0 && <Row label="Credit notes" value={`- ${money(doc.credited_amount)}`} muted />}
      <Row label="Payments received" value={`- ${money(doc.paid_amount)}`} muted />
      <Row label="Balance due" value={money(doc.balance_due)} strong />
    </dl>
  );
}

type PaymentRow = { payment: Payment; allocation: PaymentAllocation };

export function PaymentsPanel({
  doc,
  payments,
  creditNotes,
  advances,
}: {
  doc: DocumentRow;
  payments: PaymentRow[];
  creditNotes: Array<{ link: CreditNoteLink; number: string | null; href: string }>;
  advances: Array<{ link: AdvanceLink; number: string | null; href: string }>;
}) {
  const money = (n: number) => formatMoney(n, doc.currency);
  return (
    <div className="space-y-6">
      <SettlementSummary doc={doc} />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Payments</h3>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payment has been recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Applied</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map(({ payment, allocation }) => (
                <TableRow key={allocation.id}>
                  <TableCell>{formatDate(payment.payment_date)}</TableCell>
                  <TableCell>
                    <PaymentMethodLabel method={payment.method} />
                    {payment.is_adjustment && <span className="ml-2 text-xs text-warning">Adjustment</span>}
                  </TableCell>
                  <TableCell>{payment.reference ?? "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(allocation.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/sales/payments/${payment.id}`} className="text-primary hover:underline">
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {creditNotes.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Credit notes</h3>
          <ul className="space-y-1 text-sm">
            {creditNotes.map(({ link, number, href }) => (
              <li key={link.id} className="flex justify-between gap-4">
                <Link href={href} className="font-medium text-primary hover:underline">
                  {number ?? "credit note"}
                </Link>
                <span className="tabular-nums">{money(link.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {advances.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Previous advances deducted</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Advance invoice</TableHead>
                <TableHead className="text-right">HT</TableHead>
                <TableHead className="text-right">VAT (already declared)</TableHead>
                <TableHead className="text-right">Deducted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {advances.map(({ link, number, href }) => (
                <TableRow key={link.id}>
                  <TableCell>
                    <Link href={href} className="font-medium text-primary hover:underline">
                      {number ?? "advance"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(link.ht_amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(link.vat_amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(link.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "document.create": "Draft created",
  "document.update": "Draft edited",
  "document.amend": "Issued document edited",
  "document.issue": "Issued",
  "document.send": "Marked as sent",
  "document.email": "Emailed",
  "document.view_public": "Opened through the secure link",
  "document.download_pdf": "PDF downloaded",
  "document.void": "Cancelled",
  "document.convert": "Converted",
  "document.duplicate": "Duplicated",
  "document.submit_approval": "Submitted for approval",
  "document.approve": "Approved",
  "document.reject": "Rejected",
  "document.pdf_stored": "PDF stored",
  "document.link_create": "Secure link created",
  "document.link_revoke": "Secure link revoked",
  "document.accept": "Proforma accepted",
  "document.decline": "Proforma declined",
  "document.expire": "Proforma expired",
  "payment.create": "Payment recorded",
  "payment.allocate": "Payment applied",
  "payment.void": "Payment cancelled",
  "payment.adjust": "Administrator adjustment",
  "credit_note.create": "Credit note created",
  "credit_note.apply": "Credit applied",
  "advance.apply": "Advance deducted",
};

function auditSummary(entry: AuditLog): string | null {
  const meta = entry.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const summary = (meta as Record<string, unknown>).summary;
    if (typeof summary === "string") return summary;
    const reason = (meta as Record<string, unknown>).reason;
    if (typeof reason === "string") return reason;
    const note = (meta as Record<string, unknown>).note;
    if (typeof note === "string" && note) return note;
  }
  return null;
}

/** Newest-first history of everything that happened to a document: who, what, when. */
export function ActivityTimeline({ entries }: { entries: AuditLog[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No activity recorded.</p>;
  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const summary = auditSummary(entry);
        return (
          <li key={entry.id} className="flex gap-3 text-sm">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
            <div>
              <p className="font-medium">{ACTION_LABELS[entry.action] ?? entry.action.replace(/[._]/g, " ")}</p>
              {summary && <p className="text-muted-foreground">{summary}</p>}
              <p className="text-xs text-muted-foreground">
                {entry.created_at.slice(0, 16).replace("T", " ")} - {entry.actor_email ?? "System / visitor"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function EmailLogList({ logs }: { logs: EmailLog[] }) {
  if (logs.length === 0) return <p className="text-sm text-muted-foreground">No email has been sent for this document.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>To</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Provider</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell>{log.created_at.slice(0, 16).replace("T", " ")}</TableCell>
            <TableCell>{log.to_emails.join(", ")}</TableCell>
            <TableCell>
              <span className={log.status === "failed" ? "text-danger" : log.status === "sent" ? "text-success" : "text-warning"}>
                {log.status === "queued" ? "Stored (not delivered)" : log.status}
              </span>
              {log.error_message && <p className="text-xs text-muted-foreground">{log.error_message}</p>}
            </TableCell>
            <TableCell>{log.provider ?? "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
