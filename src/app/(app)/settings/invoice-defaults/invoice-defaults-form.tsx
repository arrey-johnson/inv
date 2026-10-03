"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { CURRENCY_CODES } from "@/lib/finance/money";
import {
  invoiceDefaultsSchema,
  type InvoiceDefaultsFormValues,
  type InvoiceDefaultsValues,
} from "@/lib/validations/settings";
import { updateInvoiceDefaultsAction } from "./actions";

const CURRENCY_OPTIONS = CURRENCY_CODES.map((c) => ({ value: c, label: c }));

export function InvoiceDefaultsForm({
  defaultValues,
  canEdit,
}: {
  defaultValues: InvoiceDefaultsFormValues;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<InvoiceDefaultsFormValues, unknown, InvoiceDefaultsValues>({
    resolver: zodResolver(invoiceDefaultsSchema),
    defaultValues,
  });
  const disabled = !canEdit || pending;

  function onSubmit(values: InvoiceDefaultsValues) {
    startTransition(async () => {
      const result = await updateInvoiceDefaultsAction(values);
      if (!result.ok) {
        toast.error(result.error);
        for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(name as Path<InvoiceDefaultsFormValues>, { message });
        }
        return;
      }
      toast.success("Defaults saved");
      form.reset(form.getValues());
      router.refresh();
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
            <CardDescription>
              The due date of a new document is the issue date plus the payment terms. A customer&apos;s own terms
              take precedence.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <SelectField control={form.control} name="default_currency" label="Currency" options={CURRENCY_OPTIONS} disabled={disabled} />
            <TextField control={form.control} name="default_payment_terms_days" label="Payment terms (days)" inputMode="numeric" disabled={disabled} />
            <TextField control={form.control} name="proforma_validity_days" label="Proforma validity (days)" inputMode="numeric" disabled={disabled} />
            <SwitchField
              control={form.control}
              name="show_amount_in_words"
              label="Amount in words"
              description="Print the total in words on documents."
              disabled={disabled}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Default notes and terms</CardTitle>
            <CardDescription>Pre-filled on new documents; each document can override them.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextareaField control={form.control} name="default_invoice_notes" label="Invoice notes" rows={4} disabled={disabled} />
            <TextareaField control={form.control} name="default_invoice_terms" label="Invoice terms" rows={4} disabled={disabled} />
            <TextareaField control={form.control} name="default_proforma_notes" label="Proforma notes" rows={4} disabled={disabled} />
            <TextareaField control={form.control} name="default_proforma_terms" label="Proforma terms" rows={4} disabled={disabled} />
          </CardContent>
        </Card>

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" className="h-9" disabled={pending || !form.formState.isDirty}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save defaults
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
