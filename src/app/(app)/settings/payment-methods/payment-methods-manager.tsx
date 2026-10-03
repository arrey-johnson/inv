"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import { SelectField, SwitchField, TextField } from "@/components/forms/fields";
import { PAYMENT_METHOD_LABELS } from "@/components/payments/payment-method-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  paymentDestinationSchema,
  type PaymentDestinationFormValues,
  type PaymentDestinationValues,
} from "@/lib/validations/settings";
import { PAYMENT_DESTINATION_KINDS, PAYMENT_METHODS, type PaymentMethod } from "@/types/database";
import {
  deletePaymentDestinationAction,
  savePaymentDestinationAction,
  updatePaymentMethodsAction,
} from "./actions";

export interface DestinationView {
  id: string;
  kind: "bank" | "mobile_money";
  label: string;
  provider: string | null;
  account_name: string | null;
  account_number: string | null;
  iban: string | null;
  swift: string | null;
  is_default: boolean;
  is_active: boolean;
  show_on_documents: boolean;
}

const KIND_OPTIONS = PAYMENT_DESTINATION_KINDS.map((k) => ({ value: k, label: k === "bank" ? "Bank account" : "Mobile money" }));

const EMPTY: PaymentDestinationFormValues = {
  kind: "bank",
  label: "",
  provider: "",
  account_name: "",
  account_number: "",
  iban: "",
  swift: "",
  is_default: false,
  is_active: true,
  show_on_documents: true,
};

function toForm(d: DestinationView): PaymentDestinationFormValues {
  return {
    kind: d.kind,
    label: d.label,
    provider: d.provider ?? "",
    account_name: d.account_name ?? "",
    account_number: d.account_number ?? "",
    iban: d.iban ?? "",
    swift: d.swift ?? "",
    is_default: d.is_default,
    is_active: d.is_active,
    show_on_documents: d.show_on_documents,
  };
}

export function PaymentMethodsManager({
  enabledMethods,
  destinations,
  canEdit,
}: {
  enabledMethods: PaymentMethod[];
  destinations: DestinationView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [methods, setMethods] = useState<Set<PaymentMethod>>(new Set(enabledMethods));
  const [editingId, setEditingId] = useState<string | null>(null);

  const form = useForm<PaymentDestinationFormValues, unknown, PaymentDestinationValues>({
    resolver: zodResolver(paymentDestinationSchema),
    defaultValues: EMPTY,
  });
  const kind = form.watch("kind");

  function saveMethods() {
    startTransition(async () => {
      const result = await updatePaymentMethodsAction({ enabled_payment_methods: [...methods] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Accepted methods saved");
      router.refresh();
    });
  }

  function onSubmit(values: PaymentDestinationValues) {
    startTransition(async () => {
      const result = await savePaymentDestinationAction(editingId, values);
      if (!result.ok) {
        toast.error(result.error);
        for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(name as Path<PaymentDestinationFormValues>, { message });
        }
        return;
      }
      toast.success(editingId ? "Destination saved" : "Destination added");
      setEditingId(null);
      form.reset(EMPTY);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deletePaymentDestinationAction(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Destination removed");
      if (editingId === id) {
        setEditingId(null);
        form.reset(EMPTY);
      }
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accepted methods</CardTitle>
          <CardDescription>Methods that can be recorded when a payment is received.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {PAYMENT_METHODS.map((method) => (
              <div key={method} className="flex items-center gap-2">
                <Checkbox
                  id={`pm-${method}`}
                  checked={methods.has(method)}
                  disabled={!canEdit || pending}
                  onCheckedChange={(checked) => {
                    const next = new Set(methods);
                    if (checked) next.add(method);
                    else next.delete(method);
                    setMethods(next);
                  }}
                />
                <Label htmlFor={`pm-${method}`}>{PAYMENT_METHOD_LABELS[method]}</Label>
              </div>
            ))}
          </div>
          {canEdit && (
            <Button size="sm" onClick={saveMethods} disabled={pending || methods.size === 0}>
              <Save className="size-4" aria-hidden /> Save methods
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bank and mobile money destinations</CardTitle>
          <CardDescription>
            Printed as &ldquo;Payment instructions&rdquo; on invoices. Intentionally empty until an administrator
            enters the real details - nothing is invented.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {destinations.length === 0 && <p className="text-sm text-muted-foreground">No payment destinations configured.</p>}
          {destinations.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5 text-sm">
                <p className="font-medium">
                  {d.label} <Badge variant="outline">{d.kind === "bank" ? "Bank" : "Mobile money"}</Badge>{" "}
                  {d.is_default && <Badge variant="secondary">Default</Badge>}{" "}
                  {!d.is_active && <Badge variant="outline">Inactive</Badge>}
                </p>
                <p className="text-muted-foreground">
                  {[d.provider, d.account_name, d.account_number, d.iban].filter(Boolean).join(" - ") || "No details"}
                </p>
                <p className="text-xs text-muted-foreground">{d.show_on_documents ? "Shown on documents" : "Hidden on documents"}</p>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setEditingId(d.id);
                      form.reset(toForm(d));
                    }}
                  >
                    <Pencil className="size-4" aria-hidden /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(d.id)}>
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editingId ? "Edit destination" : "Add a destination"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
                <SelectField control={form.control} name="kind" label="Type" options={KIND_OPTIONS} disabled={pending} />
                <TextField control={form.control} name="label" label="Label" placeholder="e.g. Main account" disabled={pending} />
                <TextField
                  control={form.control}
                  name="provider"
                  label={kind === "bank" ? "Bank name" : "Operator"}
                  placeholder={kind === "bank" ? "" : "MTN MoMo, Orange Money..."}
                  disabled={pending}
                />
                <TextField control={form.control} name="account_name" label="Account holder" disabled={pending} />
                <TextField
                  control={form.control}
                  name="account_number"
                  label={kind === "bank" ? "Account number" : "Mobile money number"}
                  disabled={pending}
                />
                {kind === "bank" && (
                  <>
                    <TextField control={form.control} name="iban" label="IBAN" disabled={pending} />
                    <TextField control={form.control} name="swift" label="SWIFT / BIC" disabled={pending} />
                  </>
                )}
                <SwitchField control={form.control} name="show_on_documents" label="Show on documents" disabled={pending} />
                <SwitchField control={form.control} name="is_default" label="Default destination" disabled={pending} />
                <SwitchField control={form.control} name="is_active" label="Active" disabled={pending} />
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" size="sm" disabled={pending}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : editingId ? <Save className="size-4" /> : <Plus className="size-4" />}
                    {editingId ? "Save destination" : "Add destination"}
                  </Button>
                  {editingId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(null);
                        form.reset(EMPTY);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
