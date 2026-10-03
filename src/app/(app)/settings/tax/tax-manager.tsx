"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/forms/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPercent } from "@/lib/finance/format";
import { taxRateSchema, type TaxRateFormValues, type TaxRateValues } from "@/lib/validations/settings";
import { TAX_CATEGORIES } from "@/types/database";
import { createTaxRateAction, setDefaultTaxRateAction, setTaxRateActiveAction, setVatRegisteredAction } from "./actions";

export interface TaxRateView {
  id: string;
  code: string;
  name: string;
  rate: number;
  category: string;
  is_default: boolean;
  is_active: boolean;
}

const CATEGORY_OPTIONS = TAX_CATEGORIES.map((c) => ({ value: c, label: c.replace("_", " ") }));

export function TaxManager({
  rates,
  vatRegistered,
  canEdit,
}: {
  rates: TaxRateView[];
  vatRegistered: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vat, setVat] = useState(vatRegistered);

  const form = useForm<TaxRateFormValues, unknown, TaxRateValues>({
    resolver: zodResolver(taxRateSchema),
    defaultValues: { code: "", name: "", rate: "", category: "standard", is_active: true },
  });

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  function toggleVat(next: boolean) {
    setVat(next);
    startTransition(async () => {
      const result = await setVatRegisteredAction({ vat_registered: next });
      if (!result.ok) {
        setVat(!next);
        toast.error(result.error);
        return;
      }
      toast.success(next ? "VAT enabled" : "VAT disabled - new documents use 0% / exempt");
      router.refresh();
    });
  }

  function onAdd(values: TaxRateValues) {
    startTransition(async () => {
      const result = await createTaxRateAction(values);
      if (!result.ok) {
        toast.error(result.error);
        for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(name as Path<TaxRateFormValues>, { message });
        }
        return;
      }
      toast.success("Tax rate added");
      form.reset();
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardContent className="flex items-start justify-between gap-4 pt-6">
          <div className="space-y-1">
            <p className="font-medium">Charge VAT on documents</p>
            <p className="text-sm text-muted-foreground">
              When off, every new line is 0% / exempt regardless of the rate chosen. Issued documents are never changed.
            </p>
          </div>
          <Switch checked={vat} onCheckedChange={toggleVat} disabled={!canEdit || pending} aria-label="Charge VAT" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">VAT rates</CardTitle>
          <CardDescription>VAT is computed per rate group on the net amount after discounts. The default rate pre-fills new lines.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell className="font-mono text-xs">{rate.code}</TableCell>
                  <TableCell className="font-medium">
                    {rate.name} {rate.is_default && <Badge variant="secondary">Default</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(rate.rate)}</TableCell>
                  <TableCell className="capitalize">{rate.category.replace("_", " ")}</TableCell>
                  <TableCell>{rate.is_active ? "Active" : "Inactive"}</TableCell>
                  {canEdit && (
                    <TableCell className="space-x-2 text-right">
                      {!rate.is_default && rate.is_active && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => setDefaultTaxRateAction(rate.id), "Default rate updated")}
                        >
                          Make default
                        </Button>
                      )}
                      {!rate.is_default && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            run(() => setTaxRateActiveAction(rate.id, !rate.is_active), rate.is_active ? "Rate deactivated" : "Rate activated")
                          }
                        >
                          {rate.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {rates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No VAT rates found. Run the seed migration.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a custom rate</CardTitle>
            <CardDescription>Only add rates confirmed by your accountant. Existing documents keep the rate they were issued with.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onAdd)} className="grid gap-4 sm:grid-cols-4" noValidate>
                <TextField control={form.control} name="code" label="Code" placeholder="VAT_5" disabled={pending} />
                <TextField control={form.control} name="name" label="Name" placeholder="Reduced VAT" disabled={pending} />
                <TextField control={form.control} name="rate" label="Rate (%)" inputMode="decimal" disabled={pending} />
                <SelectField control={form.control} name="category" label="Category" options={CATEGORY_OPTIONS} disabled={pending} />
                <div className="sm:col-span-4">
                  <Button type="submit" size="sm" disabled={pending}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add rate
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
