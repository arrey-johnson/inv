"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { voidPaymentAction } from "@/app/(app)/sales/finance-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** Cancel a payment (it stays in the history) and restore the balances of the invoices it paid. */
export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const result = await voidPaymentAction(paymentId, reason);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Payment cancelled: invoice balances restored");
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Ban className="size-4" aria-hidden /> Cancel payment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this payment?</DialogTitle>
            <DialogDescription>
              The payment is kept in the history, marked as cancelled, and the invoices it paid owe that money again.
            </DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Keep payment
            </Button>
            <Button type="button" variant="destructive" size="sm" disabled={pending || reason.trim().length < 5} onClick={run}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Cancel payment
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
