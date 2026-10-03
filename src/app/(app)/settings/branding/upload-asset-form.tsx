"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadBrandAssetAction } from "./actions";

export function UploadAssetForm({ kind, accept }: { kind: "letterhead" | "stamp"; accept: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set("kind", kind);
        startTransition(async () => {
          const result = await uploadBrandAssetAction(data);
          if (!result.ok) {
            toast.error(result.error, { description: result.details?.join(" ") });
            return;
          }
          toast.success(
            result.data.target === "storage" ? "Uploaded to private storage" : "Saved to local storage (.data/branding)",
          );
          formRef.current?.reset();
          router.refresh();
        });
      }}
    >
      <Input name="file" type="file" accept={accept} required className="h-8 max-w-64" disabled={pending} />
      <Button type="submit" size="sm" disabled={pending}>
        <Upload className="size-4" aria-hidden /> Upload
      </Button>
    </form>
  );
}
