"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Path } from "react-hook-form";
import { toast } from "sonner";
import { SwitchField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { formatDocumentNumber } from "@/lib/finance/document-number";
import { sequenceSchema, type SequenceFormValues, type SequenceValues } from "@/lib/validations/settings";
import { updateSequenceAction } from "./actions";

export function SequenceCard({
  title,
  defaultValues,
  lastNumber,
  year,
  canEdit,
}: {
  title: string;
  defaultValues: SequenceFormValues;
  /** Last allocated number for the current counter (0 = none yet). */
  lastNumber: number;
  year: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<SequenceFormValues, unknown, SequenceValues>({
    resolver: zodResolver(sequenceSchema),
    defaultValues,
  });

  const watched = useWatch({ control: form.control });
  const padding = Number(watched.padding);
  const start = Number(watched.start_number);
  const next = lastNumber === 0 ? Math.max(Number.isFinite(start) ? start : 1, 1) : lastNumber + 1;
  let preview = "-";
  if (Number.isInteger(padding) && padding >= 1 && padding <= 12) {
    preview = formatDocumentNumber(
      {
        prefix: watched.prefix ?? "",
        separator: watched.separator ?? "",
        include_year: Boolean(watched.include_year),
        padding,
      },
      year,
      next,
    );
  }

  function onSubmit(values: SequenceValues) {
    startTransition(async () => {
      const result = await updateSequenceAction(values);
      if (!result.ok) {
        toast.error(result.error);
        for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(name as Path<SequenceFormValues>, { message });
        }
        return;
      }
      toast.success(`${title} numbering saved`);
      form.reset(form.getValues());
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          Last issued: {lastNumber === 0 ? "none yet" : lastNumber}. Next number: <span className="font-mono">{preview}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-4" noValidate>
            <TextField control={form.control} name="prefix" label="Prefix" disabled={!canEdit || pending} />
            <TextField control={form.control} name="separator" label="Separator" disabled={!canEdit || pending} />
            <TextField control={form.control} name="padding" label="Digits" inputMode="numeric" disabled={!canEdit || pending} />
            <TextField
              control={form.control}
              name="start_number"
              label="Start number"
              inputMode="numeric"
              description="Used until the first number is issued."
              disabled={!canEdit || pending}
            />
            <SwitchField control={form.control} name="include_year" label="Include year" className="sm:col-span-2" disabled={!canEdit || pending} />
            <SwitchField control={form.control} name="reset_yearly" label="Reset every year" className="sm:col-span-2" disabled={!canEdit || pending} />
            {canEdit && (
              <div className="sm:col-span-4">
                <Button type="submit" size="sm" disabled={pending || !form.formState.isDirty}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
                </Button>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
