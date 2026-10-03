"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Path } from "react-hook-form";
import { toast } from "sonner";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { createCustomerAction, updateCustomerAction } from "@/app/(app)/sales/customers/actions";
import { customerNiuWarning } from "@/lib/customers/niu";
import { CURRENCY_CODES } from "@/lib/finance/money";
import { customerSchema, type CustomerFormValues, type CustomerValues } from "@/lib/validations/customer";
import { CUSTOMER_TYPES } from "@/types/database";

const TYPE_OPTIONS = CUSTOMER_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));
const CURRENCY_OPTIONS = CURRENCY_CODES.map((c) => ({ value: c, label: c }));

export function CustomerForm({
  customerId,
  defaultValues,
  returnTo,
}: {
  customerId?: string;
  defaultValues: CustomerFormValues;
  /** Where to go after creating (e.g. back to the document builder). */
  returnTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<CustomerFormValues, unknown, CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues,
  });

  const type = useWatch({ control: form.control, name: "customer_type" });
  const niu = useWatch({ control: form.control, name: "niu" });
  const warning = customerNiuWarning({ customer_type: type, niu: typeof niu === "string" ? niu : null });

  function onSubmit(values: CustomerValues) {
    startTransition(async () => {
      const result = customerId ? await updateCustomerAction(customerId, values) : await createCustomerAction(values);
      if (!result.ok) {
        toast.error(result.error);
        for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(name as Path<CustomerFormValues>, { message });
        }
        return;
      }
      toast.success(customerId ? "Customer saved" : "Customer created");
      const id = result.data.id;
      router.push(returnTo ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}customer=${id}` : `/sales/customers/${id}`);
      router.refresh();
    });
  }

  const busy = pending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
            <CardDescription>
              NIU and RCCM are entered exactly as the customer provides them - they are never generated.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <SelectField control={form.control} name="customer_type" label="Customer type" options={TYPE_OPTIONS} disabled={busy} />
            <TextField control={form.control} name="code" label="Customer code" placeholder="Optional" disabled={busy} />
            <TextField control={form.control} name="name" label="Name" className="sm:col-span-2" disabled={busy} />
            <TextField control={form.control} name="niu" label="NIU (Taxpayer number)" disabled={busy} />
            <TextField control={form.control} name="rccm" label="RCCM (Trade register)" disabled={busy} />
            {warning && (
              <Alert className="sm:col-span-2">
                <AlertTriangle className="size-4" aria-hidden />
                <AlertDescription>{warning} You can still save.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact and billing address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="contact_name" label="Contact person" disabled={busy} />
            <TextField control={form.control} name="phone" label="Phone" type="tel" disabled={busy} />
            <TextField control={form.control} name="email" label="Email" type="email" className="sm:col-span-2" disabled={busy} />
            <TextField control={form.control} name="address_line1" label="Address line 1" className="sm:col-span-2" disabled={busy} />
            <TextField control={form.control} name="address_line2" label="Address line 2" className="sm:col-span-2" disabled={busy} />
            <TextField control={form.control} name="city" label="City" disabled={busy} />
            <TextField control={form.control} name="region" label="Region" disabled={busy} />
            <TextField control={form.control} name="country" label="Country" disabled={busy} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billing defaults</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <SelectField control={form.control} name="default_currency" label="Default currency" options={CURRENCY_OPTIONS} disabled={busy} />
            <TextField
              control={form.control}
              name="payment_terms_days"
              label="Default payment terms (days)"
              inputMode="numeric"
              placeholder="Use company default"
              description="Leave empty to use the invoice defaults from Settings."
              disabled={busy}
            />
            <TextareaField control={form.control} name="notes" label="Internal notes" className="sm:col-span-2" disabled={busy} />
            <SwitchField
              control={form.control}
              name="is_active"
              label="Active"
              description="Inactive customers cannot be selected on new documents."
              className="sm:col-span-2"
              disabled={busy}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-9" disabled={busy} onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" className="h-9" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {customerId ? "Save changes" : "Create customer"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
