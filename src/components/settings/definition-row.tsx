import { cn } from "@/lib/utils";

/** One label/value line in a settings `<dl>`; shows an italic "Not set" for empty values. */
export function DefinitionRow({
  label,
  value,
  labelWidth = "11rem",
}: {
  label: string;
  value: string | number | boolean | null | undefined;
  labelWidth?: string;
}) {
  const text =
    typeof value === "boolean"
      ? value
        ? "Yes"
        : "No"
      : value === null || value === undefined || value === ""
        ? null
        : String(value);

  return (
    <div className="grid gap-3 py-2 text-sm" style={{ gridTemplateColumns: `${labelWidth} 1fr` }}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn(text ? "whitespace-pre-line font-medium" : "italic text-muted-foreground")}>
        {text ?? "Not set"}
      </dd>
    </div>
  );
}
