"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createItemAction } from "@/app/(app)/sales/items/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { CurrencyCode } from "@/lib/finance/money";
import { EMPTY_ITEM } from "@/lib/validations/item";
import { ITEM_TYPES, type ItemType } from "@/types/database";
import type { BuilderCatalogItem } from "./types";

export function QuickAddItemDialog({
  trigger,
  defaultTaxRateId,
  currency,
  onCreated,
}: {
  trigger: ReactNode;
  defaultTaxRateId: string | null;
  currency: CurrencyCode;
  onCreated: (item: BuilderCatalogItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<ItemType>("service");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function reset() {
    setName("");
    setItemType("service");
    setUnit("");
    setUnitPrice("");
    setDescription("");
    setFieldErrors({});
  }

  function submit() {
    startTransition(async () => {
      const result = await createItemAction({
        ...EMPTY_ITEM,
        item_type: itemType,
        name,
        unit,
        unit_price: unitPrice || "0",
        description,
        currency,
        tax_rate_id: defaultTaxRateId,
        is_active: true,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      onCreated(result.data.item);
      toast.success("Item created and added to this document");
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New product / service</DialogTitle>
          <DialogDescription>Create a catalog item and add it as a line on this document.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qa-i-type">Type</Label>
            <NativeSelect id="qa-i-type" value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "service" ? "Service" : "Product"}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-i-name">Name</Label>
            <Input
              id="qa-i-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.name)}
              autoFocus
            />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qa-i-price">Unit price HT ({currency})</Label>
              <Input
                id="qa-i-price"
                inputMode="decimal"
                className="tabular-nums"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                aria-invalid={Boolean(fieldErrors.unit_price)}
              />
              {fieldErrors.unit_price && <p className="text-xs text-destructive">{fieldErrors.unit_price}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-i-unit">Unit</Label>
              <Input id="qa-i-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. day, hour" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-i-desc">Description</Label>
            <Textarea id="qa-i-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Add item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
