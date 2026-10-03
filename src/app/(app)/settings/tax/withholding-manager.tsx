"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPercent } from "@/lib/finance/format";
import { createWithholdingAction, setWithholdingActiveAction } from "./actions";

export interface WithholdingView {
  id: string;
  code: string;
  name: string;
  rate: number;
  base: "net_ht" | "total_ttc";
  is_active: boolean;
}

/** Configurable withholding types (retenue a la source). Rates are never pre-filled: the accountant supplies them. */
export function WithholdingManager({ types, canEdit }: { types: WithholdingView[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState({ code: "", name: "", rate: "", base: "net_ht" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function add(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await createWithholdingAction(values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("Withholding type added");
      setValues({ code: "", name: "", rate: "", base: "net_ht" });
      router.refresh();
    });
  }

  function toggle(type: WithholdingView) {
    startTransition(async () => {
      const result = await setWithholdingActiveAction(type.id, !type.is_active);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(type.is_active ? "Withholding type deactivated" : "Withholding type activated");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Withholding types</CardTitle>
        <CardDescription>
          Optional on a document. A withholding lowers the net cash payable, never the invoice total TTC or its VAT. None are pre-configured: statutory
          rates must be confirmed by your accountant before being added.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead>Applied on</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-mono text-xs">{w.code}</TableCell>
                <TableCell className="font-medium">{w.name}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(w.rate)}</TableCell>
                <TableCell>{w.base === "net_ht" ? "Net amount (HT)" : "Total (TTC)"}</TableCell>
                <TableCell>{w.is_active ? "Active" : "Inactive"}</TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(w)}>
                      {w.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {types.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit ? 6 : 5} className="text-center text-muted-foreground">
                  No withholding types configured.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {canEdit && (
          <form onSubmit={add} className="grid gap-4 sm:grid-cols-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="w-code">Code</Label>
              <Input id="w-code" value={values.code} onChange={(e) => setValues({ ...values, code: e.target.value })} aria-invalid={Boolean(errors.code)} />
              {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="w-name">Name</Label>
              <Input id="w-name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} aria-invalid={Boolean(errors.name)} />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-rate">Rate (%)</Label>
              <Input
                id="w-rate"
                inputMode="decimal"
                value={values.rate}
                onChange={(e) => setValues({ ...values, rate: e.target.value })}
                aria-invalid={Boolean(errors.rate)}
              />
              {errors.rate && <p className="text-xs text-destructive">{errors.rate}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-base">Applied on</Label>
              <NativeSelect id="w-base" value={values.base} onChange={(e) => setValues({ ...values, base: e.target.value })}>
                <option value="net_ht">Net amount (HT)</option>
                <option value="total_ttc">Total (TTC)</option>
              </NativeSelect>
            </div>
            <div className="sm:col-span-5">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} Add withholding type
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
