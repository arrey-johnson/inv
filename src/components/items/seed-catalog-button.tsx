"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { seedStarterCatalogAction } from "@/app/(app)/sales/items/actions";
import { Button } from "@/components/ui/button";

export function SeedCatalogButton() {
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
          const result = await seedStarterCatalogAction();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(
            result.data.created > 0
              ? `Added ${result.data.created} services. Set their prices before using them.`
              : "The starter catalog is already loaded.",
          );
          router.refresh();
        })
      }
    >
      <Sparkles className="size-4" aria-hidden /> Load starter catalog
    </Button>
  );
}
