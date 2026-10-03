"use client";

import type { ReactNode } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface BaseProps<T extends FieldValues> {
  control: FormControlOf<T>;
  name: FieldPath<T>;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

type AnyControl<T extends FieldValues> = Control<T>;

/** `useForm<Input, unknown, Output>` yields a Control whose output generic differs from the values; accept any. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FormControlOf<T extends FieldValues> = Control<T, any, any>;

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
  type,
  placeholder,
  inputMode,
}: BaseProps<T> & { type?: string; placeholder?: string; inputMode?: "decimal" | "numeric" | "text" | "tel" | "email" }) {
  return (
    <FormField
      control={control as AnyControl<T>}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={(field.value as string | number | null | undefined) ?? ""}
              type={type}
              inputMode={inputMode}
              placeholder={placeholder}
              disabled={disabled}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
  rows = 3,
}: BaseProps<T> & { rows?: number }) {
  return (
    <FormField
      control={control as AnyControl<T>}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea {...field} value={(field.value as string | null | undefined) ?? ""} rows={rows} disabled={disabled} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
  options,
  placeholder,
}: BaseProps<T> & { options: ReadonlyArray<{ value: string; label: string }>; placeholder?: string }) {
  return (
    <FormField
      control={control as AnyControl<T>}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <NativeSelect
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
              value={(field.value as string | null | undefined) ?? ""}
              disabled={disabled}
            >
              {placeholder !== undefined && <option value="">{placeholder}</option>}
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({ control, name, label, description, disabled, className }: BaseProps<T>) {
  return (
    <FormField
      control={control as AnyControl<T>}
      name={name}
      render={({ field }) => (
        <FormItem className={cn("flex items-start justify-between gap-4 rounded-lg border p-3", className)}>
          <div className="space-y-0.5">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={disabled} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}
