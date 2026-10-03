import { z } from "zod";
import type { Repository } from "@/lib/data/types";
import { createPublicLink, type LinkEnvironment } from "@/lib/documents/link-service";
import { ServiceError, loadBundle, need, toServiceError, type Actor } from "@/lib/documents/service-support";
import { DOCUMENT_PERMISSIONS, DOCUMENT_TYPE_LABELS, isSalesDocumentType } from "@/lib/documents/status";
import type { EmailLog } from "@/types/database";
import { buildDocumentEmail, type EmailProvider } from "./index";

export const sendEmailSchema = z.object({
  documentId: z.string().uuid(),
  to: z.array(z.string().trim().email("Enter valid email addresses.")).min(1, "Add at least one recipient.").max(10),
  cc: z.array(z.string().trim().email("Enter valid email addresses.")).max(10).default([]),
  message: z.string().trim().max(2000).optional().nullable(),
  /** Add a secure link to the email (creates a NEW link, which replaces the previous one). */
  includeLink: z.boolean().default(false),
});
export type SendEmailInput = z.infer<typeof sendEmailSchema>;

export interface SendEmailDependencies {
  provider: EmailProvider;
  renderPdf: (repo: Repository, documentId: string) => Promise<{ bytes: Uint8Array; filename: string }>;
  link: LinkEnvironment;
}

export interface SendEmailOutcome {
  log: EmailLog;
  /** True when the provider only stored the message (demo outbox): nothing was delivered. */
  delivered: boolean;
  linkUrl: string | null;
}

/** Send a document (PDF attached) and record the attempt in `email_logs`, whatever the outcome. */
export async function sendDocumentEmail(
  repo: Repository,
  actor: Actor,
  rawInput: unknown,
  deps: SendEmailDependencies,
): Promise<SendEmailOutcome> {
  try {
    const parsed = sendEmailSchema.safeParse(rawInput);
    if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "Invalid email.", "invalid");
    const input = parsed.data;

    const bundle = await loadBundle(repo, input.documentId);
    const doc = bundle.document;
    if (!isSalesDocumentType(doc.document_type)) throw new ServiceError("This document cannot be emailed.", "invalid");
    need(actor, DOCUMENT_PERMISSIONS[doc.document_type].send);
    if (doc.status === "draft") throw new ServiceError("Issue the document before sending it.", "conflict");
    if (doc.status === "void") throw new ServiceError("A cancelled document cannot be sent.", "conflict");
    if (!doc.number) throw new ServiceError("The document has no number yet.", "conflict");

    const organization = await repo.organization.get();
    let linkUrl: string | null = null;
    if (input.includeLink) {
      linkUrl = (await createPublicLink(repo, actor, doc.id, deps.link)).url;
    }

    const pdf = await deps.renderPdf(repo, doc.id);
    const mail = buildDocumentEmail({
      documentLabel: DOCUMENT_TYPE_LABELS[doc.document_type],
      number: doc.number,
      customerName: bundle.customer?.name ?? "customer",
      companyName: organization?.trade_name ?? organization?.legal_name ?? "Promptstack Technologies",
      total: doc.document_type === "invoice" || doc.document_type === "advance" ? doc.net_payable : doc.total_ttc,
      currency: doc.currency,
      dueDate: doc.due_date,
      publicUrl: linkUrl,
      message: input.message,
    });

    const result = await deps.provider.send({
      to: input.to,
      cc: input.cc,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: [{ filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" }],
    });

    const sentAt = result.ok && result.status === "sent" ? new Date().toISOString() : null;
    const log = await repo.emailLogs.add({
      document_id: doc.id,
      customer_id: doc.customer_id,
      to_emails: input.to,
      cc_emails: input.cc,
      subject: mail.subject,
      template: "document",
      status: result.ok ? (result.status === "sent" ? "sent" : "queued") : "failed",
      provider: result.provider,
      provider_message_id: result.messageId ?? null,
      error_message: result.ok ? null : (result.error ?? "Unknown error"),
      sent_by: repo.context.userId,
      sent_at: sentAt,
    });

    await repo.writeAudit({
      action: "document.email",
      entityType: "document",
      entityId: doc.id,
      metadata: {
        number: doc.number,
        to: input.to,
        provider: result.provider,
        status: log.status,
        link_included: Boolean(linkUrl),
        summary:
          log.status === "sent"
            ? `Emailed to ${input.to.join(", ")}`
            : log.status === "queued"
              ? `Email stored in the demo outbox for ${input.to.join(", ")} (not delivered)`
              : `Email to ${input.to.join(", ")} failed`,
      },
    });

    if (!result.ok) throw new ServiceError(`The email was not sent: ${result.error ?? "unknown error"}`, "conflict");

    if (sentAt) {
      await repo.documents.patchWorkflow(doc.id, {
        sent_at: sentAt,
        ...(doc.status === "issued" ? { status: "sent" as const } : {}),
      });
      if (doc.status === "issued") {
        await repo.writeAudit({
          action: "document.send",
          entityType: "document",
          entityId: doc.id,
          metadata: { number: doc.number, via: "email" },
        });
      }
    }
    return { log, delivered: sentAt !== null, linkUrl };
  } catch (cause) {
    throw toServiceError(cause);
  }
}
