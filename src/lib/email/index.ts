import { escapeHtml } from "./templates";

/**
 * Email delivery abstraction.
 *
 * Providers (all behind `EmailProvider`):
 *  - `none`        refuses to send and says so (default when nothing is configured);
 *  - `resend`      real delivery through the Resend HTTP API;
 *  - `demo-outbox` demo mode only: writes the message and its attachments to `.data/outbox/` and reports
 *                  status `queued`. It never claims the email was delivered.
 * SMTP is not implemented; selecting it behaves like `none` with an explicit message.
 */
export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface EmailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  ok: boolean;
  provider: string;
  /** `sent` = handed to a real mail service; `queued` = stored locally, nothing was delivered. */
  status?: "sent" | "queued";
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** Default provider: refuses to send and reports clearly, so nothing silently "succeeds". */
export class DisabledEmailProvider implements EmailProvider {
  constructor(
    readonly name = "none",
    private readonly reason = "Email delivery is not configured (EMAIL_PROVIDER=none).",
  ) {}
  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.warn(`[email] provider disabled - not sending "${escapeHtml(message.subject)}" to ${message.to.length} recipient(s)`);
    return { ok: false, provider: this.name, error: this.reason };
  }
}

export { buildDocumentEmail, escapeHtml } from "./templates";
