import type { ReactNode } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

/** GET form: filters live in the URL (shareable, back-button friendly, no client JS needed). */
export function FilterBar({ resetHref, children }: { resetHref: string; children: ReactNode }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      {children}
      <div className="ml-auto flex gap-2">
        <Link href={resetHref} className="inline-flex h-8 items-center rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground">
          Reset
        </Link>
        <Button type="submit" size="sm">
          <Search className="size-4" aria-hidden /> Apply
        </Button>
      </div>
    </form>
  );
}

export function FilterField({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ?? "space-y-1"}>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function FilterInput({
  name,
  label,
  value,
  type = "text",
  placeholder,
  className,
}: {
  name: string;
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <FilterField label={label} htmlFor={`f-${name}`} className={className ?? "space-y-1"}>
      <Input id={`f-${name}`} name={name} type={type} defaultValue={value} placeholder={placeholder} className="h-8" />
    </FilterField>
  );
}

export function FilterCheckbox({
  name,
  label,
  checked,
}: {
  name: string;
  label: string;
  checked: boolean;
}) {
  return (
    <label className="flex h-8 items-center gap-2 text-sm">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} className="size-4 rounded border-input accent-primary" />
      {label}
    </label>
  );
}

export function FilterSelect({
  name,
  label,
  value,
  options,
  allLabel = "All",
  allValue = "",
}: {
  name: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  allLabel?: string;
  /** Value submitted for the "all" option (use "all" when the page's default is a specific value). */
  allValue?: string;
}) {
  return (
    <FilterField label={label} htmlFor={`f-${name}`}>
      <NativeSelect id={`f-${name}`} name={name} defaultValue={value} className="min-w-32">
        <option value={allValue}>{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </FilterField>
  );
}
