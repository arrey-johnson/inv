import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./index";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await this.fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: this.from,
          to: message.to,
          cc: message.cc?.length ? message.cc : undefined,
          subject: message.subject,
          html: message.html,
          text: message.text,
          attachments: (message.attachments ?? []).map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content).toString("base64"),
          })),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) {
        return { ok: false, provider: this.name, error: body.message ?? `Resend responded with HTTP ${response.status}.` };
      }
      return { ok: true, provider: this.name, status: "sent", messageId: body.id };
    } catch (error) {
      return { ok: false, provider: this.name, error: error instanceof Error ? error.message : "Could not reach the email service." };
    }
  }
}

/** Demo mode: keep the email on disk so it can be inspected. Nothing leaves the machine. */
export class DemoOutboxEmailProvider implements EmailProvider {
  readonly name = "demo-outbox";

  constructor(private readonly directory: string = path.join(process.cwd(), ".data", "outbox")) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
      const folder = path.join(this.directory, id);
      await mkdir(folder, { recursive: true });
      const files: string[] = [];
      for (const attachment of message.attachments ?? []) {
        const safe = attachment.filename.replace(/[^A-Za-z0-9._-]/g, "_");
        await writeFile(path.join(folder, safe), attachment.content);
        files.push(safe);
      }
      await writeFile(
        path.join(folder, "message.json"),
        JSON.stringify(
          { to: message.to, cc: message.cc ?? [], subject: message.subject, text: message.text, attachments: files, note: "Demo outbox: this email was NOT delivered." },
          null,
          2,
        ),
      );
      await writeFile(path.join(folder, "message.html"), message.html);
      return { ok: true, provider: this.name, status: "queued", messageId: id };
    } catch (error) {
      return { ok: false, provider: this.name, error: error instanceof Error ? error.message : "Could not write to the demo outbox." };
    }
  }
}
