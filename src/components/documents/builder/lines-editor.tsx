"use client";

import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber } from "@/lib/finance/format";
import type { CalcLineResult } from "@/lib/finance/calculate-document";
import type { CurrencyCode } from "@/lib/finance/money";
import { emptyLine, type BuilderLine } from "@/lib/documents/builder-model";
import { DISCOUNT_TYPES } from "@/types/database";
import { QuickAddItemDialog } from "./quick-add-item-dialog";
import type { BuilderCatalogItem } from "./types";

const DISCOUNT_LABELS = { none: "None", percentage: "%", fixed: "Amount" } as const;

export function LinesEditor({
  lines,
  results,
  defaultTaxRateId,
  catalog,
  currency,
  disabled,
  errors,
  onChange,
  onCatalogItemAdded,
}: {
  lines: BuilderLine[];
  results: ReadonlyArray<CalcLineResult | null>;
  /** Applied silently to every new line — VAT is shown only in document totals. */
  defaultTaxRateId: string | null;
  catalog: ReadonlyArray<BuilderCatalogItem>;
  currency: CurrencyCode;
  disabled: boolean;
  /** Server validation messages keyed `lines.<index>.<field>`. */
  errors: Record<string, string>;
  onChange: (lines: BuilderLine[]) => void;
  onCatalogItemAdded: (item: BuilderCatalogItem) => void;
}) {
  const update = (index: number, patch: Partial<BuilderLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));

  /** When VAT is off, defaultTaxRateId is null — never inherit a catalog item's rate. */
  const taxForNewLine = (itemTaxRateId: string | null | undefined) =>
    defaultTaxRateId ? (itemTaxRateId ?? defaultTaxRateId) : null;

  function addFromCatalog(itemId: string) {
    const item = catalog.find((c) => c.id === itemId);
    if (!item) return;
    onChange([
      ...lines,
      {
        ...emptyLine(taxForNewLine(item.tax_rate_id), item.unit ?? ""),
        itemId: item.id,
        description: item.name,
        details: item.description ?? "",
        unitPrice: item.unit_price,
      },
    ]);
  }

  function addCustomLine() {
    onChange([...lines, emptyLine(defaultTaxRateId)]);
  }

  const fieldError = (index: number, field: string) => errors[`lines.${index}.${field}`];

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2">#</th>
              <th className="px-2 py-2">Description</th>
              <th className="w-20 px-2 py-2">Qty</th>
              <th className="w-24 px-2 py-2">Unit</th>
              <th className="w-32 px-2 py-2">Unit price HT</th>
              <th className="w-36 px-2 py-2">Discount</th>
              <th className="w-32 px-2 py-2 text-right">Amount HT</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  No lines yet. Add one from the catalog or create a custom line.
                </td>
              </tr>
            )}
            {lines.map((line, index) => (
              <tr key={line.key} className="border-t align-top">
                <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                <td className="space-y-1 px-2 py-2">
                  <Input
                    aria-label={`Line ${index + 1} description`}
                    aria-invalid={Boolean(fieldError(index, "description"))}
                    value={line.description}
                    disabled={disabled}
                    onChange={(e) => update(index, { description: e.target.value })}
                    placeholder="Description"
                  />
                  <Textarea
                    aria-label={`Line ${index + 1} details`}
                    value={line.details}
                    disabled={disabled}
                    rows={1}
                    onChange={(e) => update(index, { details: e.target.value })}
                    placeholder="Details (optional)"
                    className="min-h-8 text-xs"
                  />
                  {fieldError(index, "description") && (
                    <p className="text-xs text-destructive">{fieldError(index, "description")}</p>
                  )}
                </td>
                <td className="px-2 py-2">
                  <Input
                    aria-label={`Line ${index + 1} quantity`}
                    aria-invalid={Boolean(fieldError(index, "quantity"))}
                    inputMode="decimal"
                    value={line.quantity}
                    disabled={disabled}
                    onChange={(e) => update(index, { quantity: e.target.value })}
                  />
                  {fieldError(index, "quantity") && (
                    <p className="mt-1 text-xs text-destructive">{fieldError(index, "quantity")}</p>
                  )}
                </td>
                <td className="px-2 py-2">
                  <Input
                    aria-label={`Line ${index + 1} unit`}
                    value={line.unit}
                    disabled={disabled}
                    onChange={(e) => update(index, { unit: e.target.value })}
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    aria-label={`Line ${index + 1} unit price`}
                    aria-invalid={Boolean(fieldError(index, "unitPrice"))}
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    value={line.unitPrice}
                    disabled={disabled}
                    onChange={(e) => update(index, { unitPrice: e.target.value })}
                  />
                  {fieldError(index, "unitPrice") && (
                    <p className="mt-1 text-xs text-destructive">{fieldError(index, "unitPrice")}</p>
                  )}
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-1">
                    <NativeSelect
                      aria-label={`Line ${index + 1} discount type`}
                      className="w-20"
                      value={line.discountType}
                      disabled={disabled}
                      onChange={(e) =>
                        update(index, {
                          discountType: e.target.value as BuilderLine["discountType"],
                          discountValue: e.target.value === "none" ? "0" : line.discountValue,
                        })
                      }
                    >
                      {DISCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {DISCOUNT_LABELS[t]}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      aria-label={`Line ${index + 1} discount value`}
                      aria-invalid={Boolean(fieldError(index, "discountValue"))}
                      inputMode="decimal"
                      className="w-16 text-right tabular-nums"
                      value={line.discountType === "none" ? "" : line.discountValue}
                      disabled={disabled || line.discountType === "none"}
                      onChange={(e) => update(index, { discountValue: e.target.value })}
                    />
                  </div>
                  {fieldError(index, "discountValue") && (
                    <p className="mt-1 text-xs text-destructive">{fieldError(index, "discountValue")}</p>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {results[index] ? (
                    formatNumber(results[index]?.taxableAmount ?? results[index]?.netAmount, currency)
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={disabled}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="Add from catalog"
            className="w-72"
            value=""
            onChange={(e) => {
              addFromCatalog(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Add from catalog...</option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku ? `${item.sku} - ` : ""}
                {item.name}
              </option>
            ))}
          </NativeSelect>
          <QuickAddItemDialog
            defaultTaxRateId={defaultTaxRateId}
            currency={currency}
            onCreated={(item) => {
              onCatalogItemAdded(item);
              onChange([
                ...lines,
                {
                  ...emptyLine(taxForNewLine(item.tax_rate_id), item.unit ?? ""),
                  itemId: item.id,
                  description: item.name,
                  details: item.description ?? "",
                  unitPrice: item.unit_price,
                },
              ]);
            }}
            trigger={
              <Button type="button" variant="outline" size="sm">
                <PackagePlus className="size-4" aria-hidden /> New item
              </Button>
            }
          />
          <Button type="button" variant="outline" size="sm" onClick={addCustomLine}>
            <Plus className="size-4" aria-hidden /> Custom line
          </Button>
        </div>
      )}
    </div>
  );
}
