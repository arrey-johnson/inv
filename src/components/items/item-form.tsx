"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { createItemAction, updateItemAction } from "@/app/(app)/sales/items/actions";
import { CURRENCY_CODES } from "@/lib/finance/money";
import { itemSchema, type ItemFormValues, type ItemValues } from "@/lib/validations/item";
import { ITEM_TYPES } from "@/types/database";

const TYPE_OPTIONS = ITEM_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));
const CURRENCY_OPTIONS = CURRENCY_CODES.map((c) => ({ value: c, label: c }));

export function ItemForm({
  itemId,
  defaultValues,
  taxRateOptions,
}: {
  itemId?: string;
  defaultValues: ItemFormValues;
  taxRateOptions: ReadonlyArray<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<ItemFormValues, unknown, ItemValues>({
    resolver: zodResolver(itemSchema),
    defaultValues,
  });

  function onSubmit(values: ItemValues) {
    startTransition(async () => {
      const result = itemId ? await updateItemAction(itemId, values) : await createItemAction(values);
      if (!result.ok) {
        toast.error(result.error);
        for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(name as Path<ItemFormValues>, { message });
        }
        return;
      }
      toast.success(itemId ? "Item saved" : "Item created");
      router.push("/sales/items");
      router.refresh();
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <SelectField control={form.control} name="item_type" label="Type" options={TYPE_OPTIONS} disabled={pending} />
            <TextField control={form.control} name="sku" label="Code" placeholder="e.g. WEB-DEV" disabled={pending} />
            <TextField control={form.control} name="name" label="Name" className="sm:col-span-2" disabled={pending} />
            <TextareaField control={form.control} name="description" label="Description" className="sm:col-span-2" disabled={pending} />
            <TextField control={form.control} name="unit" label="Unit" placeholder="project, hour, month..." disabled={pending} />
            <TextField
              control={form.control}
              name="unit_price"
              label="Default selling price (HT)"
              inputMode="decimal"
              description="Price excluding tax."
              disabled={pending}
            />
            <SelectField control={form.control} name="currency" label="Currency" options={CURRENCY_OPTIONS} disabled={pending} />
            <SelectField
              control={form.control}
              name="tax_rate_id"
              label="Default tax"
              options={taxRateOptions}
              placeholder="Use company default"
              disabled={pending}
            />
            <SwitchField
              control={form.control}
              name="is_active"
              label="Active"
              description="Inactive items are hidden from the document builder."
              className="sm:col-span-2"
              disabled={pending}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" className="h-9" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {itemId ? "Save changes" : "Create item"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
