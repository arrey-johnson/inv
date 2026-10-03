"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  companyProfileSchema,
  type CompanyProfileFormValues,
  type CompanyProfileValues,
} from "@/lib/validations/organization";
import { updateCompanyProfileAction } from "./actions";

type FieldDef = {
  name: Path<CompanyProfileFormValues>;
  label: string;
  placeholder?: string;
  description?: string;
  type?: string;
  span?: 2;
};

const IDENTITY_FIELDS: FieldDef[] = [
  { name: "legal_name", label: "Legal name", span: 2 },
  { name: "trade_name", label: "Trade name", placeholder: "Shown in the app header" },
  { name: "niu", label: "NIU (Taxpayer number)", description: "Printed on documents when provided. Leave empty until confirmed." },
  { name: "rccm", label: "RCCM (Trade register)", description: "Printed on documents when provided." },
];

const CONTACT_FIELDS: FieldDef[] = [
  { name: "address_line1", label: "Address line 1", span: 2 },
  { name: "address_line2", label: "Address line 2", span: 2 },
  { name: "city", label: "City" },
  { name: "region", label: "Region" },
  { name: "country", label: "Country" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "email", label: "Email", type: "email" },
  { name: "website", label: "Website", type: "url", placeholder: "https://" },
];

export function CompanyForm({
  defaultValues,
  canEdit,
}: {
  defaultValues: CompanyProfileFormValues;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const form = useForm<CompanyProfileFormValues, unknown, CompanyProfileValues>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues,
  });

  function onSubmit(values: CompanyProfileValues) {
    startTransition(async () => {
      const result = await updateCompanyProfileAction(values);
      if (result.ok) {
        toast.success("Company details saved");
        form.reset(form.getValues());
        return;
      }
      toast.error(result.error);
      for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) form.setError(name as Path<CompanyProfileFormValues>, { message: messages[0] });
      }
    });
  }

  const renderField = (def: FieldDef) => (
    <FormField
      key={def.name}
      control={form.control}
      name={def.name}
      render={({ field }) => (
        <FormItem className={def.span === 2 ? "sm:col-span-2" : undefined}>
          <FormLabel>{def.label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={(field.value as string | null | undefined) ?? ""}
              type={def.type}
              placeholder={def.placeholder}
              disabled={!canEdit || pending}
            />
          </FormControl>
          {def.description && <FormDescription>{def.description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Legal identity</CardTitle>
            <CardDescription>
              Official company information. NIU and RCCM are never auto-filled - enter the values from your
              registration documents.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">{IDENTITY_FIELDS.map(renderField)}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Address and contact</CardTitle>
            <CardDescription>Used on documents and customer emails.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">{CONTACT_FIELDS.map(renderField)}</CardContent>
          {canEdit && (
            <CardFooter className="justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={pending || !form.formState.isDirty}
                onClick={() => form.reset()}
              >
                Reset
              </Button>
              <Button type="submit" className="h-9" disabled={pending || !form.formState.isDirty}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save changes
              </Button>
            </CardFooter>
          )}
        </Card>
      </form>
    </Form>
  );
}
