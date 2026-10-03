"use client";

import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import { SwitchField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import {
  brandingSettingsSchema,
  type BrandingSettingsFormValues,
  type BrandingSettingsValues,
} from "@/lib/validations/settings";
import { saveBrandingSettingsAction } from "./actions";

export function BrandingSettingsForm({
  defaultValues,
  canEdit,
}: {
  defaultValues: BrandingSettingsFormValues;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<BrandingSettingsFormValues, unknown, BrandingSettingsValues>({
    resolver: zodResolver(brandingSettingsSchema),
    defaultValues,
  });
  const disabled = !canEdit || pending;

  function onSubmit(values: BrandingSettingsValues) {
    startTransition(async () => {
      const result = await saveBrandingSettingsAction(values);
      if (!result.ok) {
        toast.error(result.error);
        for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(name as Path<BrandingSettingsFormValues>, { message });
        }
        return;
      }
      toast.success("Branding settings saved");
      form.reset(form.getValues());
      router.refresh();
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approval and signatory</CardTitle>
            <CardDescription>
              The signatory is printed under the stamp on issued documents. Nothing is printed when left empty.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <SwitchField
              control={form.control}
              name="require_approval"
              label="Require approval before issuing"
              description="Drafts must be approved by an administrator or accountant before they can be issued."
              className="sm:col-span-2"
              disabled={disabled}
            />
            <TextField control={form.control} name="signatory_name" label="Signatory name" disabled={disabled} />
            <TextField control={form.control} name="signatory_position" label="Signatory position" disabled={disabled} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stamp placement</CardTitle>
            <CardDescription>
              Position in PDF points on the last page (A4 = 595 x 842, origin bottom-left). Leave empty for the
              default placement.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <SwitchField
              control={form.control}
              name="stamp_enabled"
              label="Apply the stamp on issued documents"
              description="Drafts and void documents never receive a stamp."
              className="sm:col-span-3"
              disabled={disabled}
            />
            <TextField control={form.control} name="stamp_x" label="X (from left)" inputMode="decimal" disabled={disabled} />
            <TextField control={form.control} name="stamp_y" label="Y (from bottom)" inputMode="decimal" disabled={disabled} />
            <TextField control={form.control} name="stamp_width" label="Width" inputMode="decimal" disabled={disabled} />
          </CardContent>
        </Card>

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" className="h-9" disabled={pending || !form.formState.isDirty}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
