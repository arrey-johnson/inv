"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Check, Clock, FileMinus2, Link2, Loader2, Mail, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import {
  applyAdvanceAction,
  createLinkAction,
  respondProformaAction,
  revokeLinkAction,
  sendEmailAction,
  voidDocumentAction,
} from "@/app/(app)/sales/finance-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions/helpers";
import type { LifecycleActions } from "@/lib/documents/lifecycle";
import { formatMoney } from "@/lib/finance/format";
import type { CurrencyCode } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

type Dialogs = "void" | "decline" | "accept" | "expire" | "email" | "advance" | null;

export interface AvailableAdvanceView {
  id: string;
  number: string;
  remaining: number;
}

export interface LifecycleBarProps {
  documentId: string;
  documentType: string;
  documentNumber: string | null;
  currency: CurrencyCode;
  customerId: string;
  customerEmail: string | null;
  actions: LifecycleActions;
  availableAdvances: AvailableAdvanceView[];
}

/** Buttons for everything that can happen to a document AFTER it has been issued. The server re-checks every step. */
export function DocumentLifecycleBar(props: LifecycleBarProps) {
  const { documentId, documentNumber, actions, currency } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [text, setText] = useState("");
  const [to, setTo] = useState(props.customerEmail ?? "");
  const [cc, setCc] = useState("");
  const [includeLink, setIncludeLink] = useState(true);
  const [advanceId, setAdvanceId] = useState(props.availableAdvances[0]?.id ?? "");

  function report<T>(result: ActionResult<T>, onOk: (data: T) => void) {
    if (!result.ok) {
      toast.error(result.error, { description: result.details?.join("\n") });
      router.refresh();
      return;
    }
    onOk(result.data);
  }

  function close() {
    setDialog(null);
    setText("");
  }

  const doVoid = () =>
    startTransition(async () =>
      report(await voidDocumentAction(documentId, text), (data) => {
        toast.success(`${documentNumber ?? "Document"} cancelled`, { description: "The number is kept and the PDF is marked CANCELLED." });
        if (data.pdfError) toast.error("The cancelled PDF could not be stored", { description: data.pdfError });
        close();
        router.refresh();
      }),
    );

  const respond = (response: "accept" | "decline" | "expire") =>
    startTransition(async () =>
      report(await respondProformaAction(documentId, response, text || undefined), () => {
        toast.success(response === "accept" ? "Proforma accepted" : response === "decline" ? "Proforma declined" : "Proforma marked as expired");
        close();
        router.refresh();
      }),
    );

  const sendEmail = () =>
    startTransition(async () => {
      const split = (value: string) =>
        value
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      report(
        await sendEmailAction({ documentId, to: split(to), cc: split(cc), message: text || null, includeLink }),
        (data) => {
          if (data.delivered) toast.success("Email sent");
          else
            toast.warning("Email stored in the demo outbox", {
              description: "Nothing was delivered: no real email provider is configured. See .data/outbox.",
            });
          close();
          router.refresh();
        },
      );
    });

  const applyAdvance = () =>
    startTransition(async () =>
      report(await applyAdvanceAction({ advanceId, invoiceId: documentId }), (data) => {
        toast.success(`Advance deducted: ${formatMoney(data.applied, currency)}`);
        close();
        router.refresh();
      }),
    );

  const anything =
    actions.recordPayment ||
    actions.createCreditNote ||
    actions.applyAdvance ||
    actions.voidDocument ||
    actions.voidBlockedReason ||
    actions.acceptProforma ||
    actions.sendEmail;
  if (!anything) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {actions.recordPayment && (
          <Link
            href={`/sales/payments/new?customer=${props.customerId}&invoice=${documentId}`}
            className={cn(buttonVariants({ size: "sm" }))}
          >
            <Wallet className="size-4" aria-hidden /> Record payment
          </Link>
        )}
        {actions.createCreditNote && (
          <Link href={`/sales/credit-notes/new?invoice=${documentId}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <FileMinus2 className="size-4" aria-hidden /> Credit note
          </Link>
        )}
        {actions.applyAdvance && props.availableAdvances.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog("advance")}>
            Deduct advance
          </Button>
        )}
        {actions.acceptProforma && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog("accept")}>
            <Check className="size-4" aria-hidden /> Accepted
          </Button>
        )}
        {actions.declineProforma && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog("decline")}>
            <X className="size-4" aria-hidden /> Declined
          </Button>
        )}
        {actions.markExpired && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog("expire")}>
            <Clock className="size-4" aria-hidden /> Mark expired
          </Button>
        )}
        {actions.sendEmail && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog("email")}>
            <Mail className="size-4" aria-hidden /> Send by email
          </Button>
        )}
        {actions.voidDocument && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDialog("void")}>
            <Ban className="size-4" aria-hidden /> Cancel document
          </Button>
        )}
      </div>
      {actions.voidBlockedReason && !actions.voidDocument && (
        <p className="text-xs text-muted-foreground">Cannot be cancelled: {actions.voidBlockedReason}</p>
      )}

      <Dialog open={dialog === "void"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {documentNumber}?</DialogTitle>
            <DialogDescription>
              The document is never deleted: its number stays in the register, the reason is recorded and the PDF is marked CANCELLED.
            </DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Reason" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason for the cancellation (required)" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={close}>
              Keep document
            </Button>
            <Button type="button" variant="destructive" size="sm" disabled={pending || text.trim().length < 5} onClick={doVoid}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Cancel document
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {(["accept", "decline", "expire"] as const).map((kind) => (
        <Dialog key={kind} open={dialog === kind} onOpenChange={(open) => !open && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {kind === "accept" ? "Customer accepted this proforma" : kind === "decline" ? "Customer declined this proforma" : "Mark this proforma as expired"}
              </DialogTitle>
              <DialogDescription>The number and amounts never change. An accepted proforma can then be converted into an invoice.</DialogDescription>
            </DialogHeader>
            <Textarea aria-label="Note" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Note (optional): who answered, how" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={close}>
                Back
              </Button>
              <Button type="button" size="sm" disabled={pending} onClick={() => respond(kind)}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Confirm
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ))}

      <Dialog open={dialog === "email"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {documentNumber} by email</DialogTitle>
            <DialogDescription>The PDF is attached. Every attempt is recorded in the email log.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mail-to">To</Label>
              <Input id="mail-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com, other@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mail-cc">Cc (optional)</Label>
              <Input id="mail-cc" value={cc} onChange={(e) => setCc(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mail-msg">Message (optional)</Label>
              <Textarea id="mail-msg" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={includeLink} onChange={(e) => setIncludeLink(e.target.checked)} />
              Include a secure link (replaces any existing link)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={pending || !to.trim()} onClick={sendEmail}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Send
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "advance"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deduct an advance</DialogTitle>
            <DialogDescription>
              The advance was invoiced (and its VAT declared) earlier, so the VAT is not charged twice. The invoice keeps its full total; the amount
              still to pay goes down.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="adv">Advance invoice</Label>
            <select
              id="adv"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
              value={advanceId}
              onChange={(e) => setAdvanceId(e.target.value)}
            >
              {props.availableAdvances.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number} - {formatMoney(a.remaining, currency)} available
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">The lower of the advance left and the invoice balance is deducted.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={pending || !advanceId} onClick={applyAdvance}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Deduct
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Create / replace / revoke the secure public link of a document. The raw link is shown once. */
export function PublicLinkPanel({
  documentId,
  status,
  createdAt,
  expiresAt,
  canManage,
}: {
  documentId: string;
  status: "none" | "valid" | "expired" | "revoked";
  createdAt: string | null;
  expiresAt: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState("90");
  const [url, setUrl] = useState<string | null>(null);

  const create = () =>
    startTransition(async () => {
      const result = await createLinkAction(documentId, days.trim() === "" ? null : Number(days));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setUrl(result.data.url);
      toast.success("Secure link created");
      router.refresh();
    });

  const revoke = () =>
    startTransition(async () => {
      const result = await revokeLinkAction(documentId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setUrl(null);
      toast.success("Link revoked: it no longer works");
      router.refresh();
    });

  const label =
    status === "valid"
      ? `Active${expiresAt ? `, expires ${expiresAt.slice(0, 10)}` : ", never expires"}`
      : status === "expired"
        ? "Expired"
        : status === "revoked"
          ? "Revoked"
          : "No link yet";

  return (
    <div className="space-y-3 text-sm">
      <p>
        Status: <strong>{label}</strong>
        {createdAt && <span className="text-muted-foreground"> (created {createdAt.slice(0, 10)})</span>}
      </p>
      {url && (
        <div className="space-y-1 rounded-md border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Copy this link now: for security it is shown only once and cannot be recovered.</p>
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Secure link" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Link copied"))}
            >
              Copy
            </Button>
          </div>
        </div>
      )}
      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="link-days" className="text-xs text-muted-foreground">
              Valid for (days, empty = no expiry)
            </Label>
            <Input id="link-days" className="h-8 w-32" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <Button type="button" size="sm" onClick={create} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
            {status === "valid" ? "Replace link" : "Create link"}
          </Button>
          {status === "valid" && (
            <Button type="button" variant="outline" size="sm" onClick={revoke} disabled={pending}>
              Revoke
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
