"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setCustomerActiveAction } from "@/app/(app)/sales/customers/actions";
import { Button } from "@/components/ui/button";

export function CustomerActiveButton({ customerId, isActive }: { customerId: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setCustomerActiveAction(customerId, !isActive);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(isActive ? "Customer deactivated" : "Customer reactivated");
          router.refresh();
        })
      }
    >
      {isActive ? "Deactivate" : "Reactivate"}
    </Button>
  );
}
