import { formatMoney } from "@/lib/finance/format";
import type { CurrencyCode } from "@/lib/finance/money";
import { formatDate } from "@/lib/utils/dates";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface DocumentEmailInput {
  documentLabel: string; // "Invoice"
  number: string;
  customerName: string;
  companyName: string;
  total: number;
  currency: CurrencyCode;
  dueDate?: string | null;
  /** Secure link to the document. Omitted when the email only carries the PDF attachment. */
  publicUrl?: string | null;
  message?: string | null;
}

/** HTML + text bodies. Every dynamic value is escaped; the link is the only call to action. */
export function buildDocumentEmail(input: DocumentEmailInput): { subject: string; html: string; text: string } {
  const subject = `${input.documentLabel} ${input.number} from ${input.companyName}`;
  const total = formatMoney(input.total, input.currency);
  const due = input.dueDate ? ` Payment is due on ${formatDate(input.dueDate)}.` : "";
  const note = input.message?.trim();

  const text = [
    `Hello ${input.customerName},`,
    "",
    `Please find ${input.documentLabel.toLowerCase()} ${input.number} for ${total}.${due}`,
    note ? `\n${note}\n` : "",
    input.publicUrl ? `View or download it here: ${input.publicUrl}` : "The PDF is attached to this email.",
    "",
    `Kind regards,`,
    input.companyName,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f1fa;font-family:Arial,Helvetica,sans-serif;color:#1c1c1f;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;border-top:4px solid #8d15b7;">
    <tr><td style="padding:28px;">
      <p style="margin:0 0 16px;">Hello ${escapeHtml(input.customerName)},</p>
      <p style="margin:0 0 16px;">Please find ${escapeHtml(input.documentLabel.toLowerCase())} <strong>${escapeHtml(input.number)}</strong> for <strong>${escapeHtml(total)}</strong>.${escapeHtml(due)}</p>
      ${note ? `<p style="margin:0 0 16px;white-space:pre-line;">${escapeHtml(note)}</p>` : ""}
      ${
        input.publicUrl
          ? `<p style="margin:24px 0;"><a href="${escapeHtml(input.publicUrl)}" style="background:#8d15b7;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;">View document</a></p>`
          : `<p style="margin:24px 0;">The PDF is attached to this email.</p>`
      }
      <p style="margin:0;color:#66666e;font-size:13px;">Kind regards,<br>${escapeHtml(input.companyName)}</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}
