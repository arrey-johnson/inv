"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Save, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { saveDraftAction } from "@/app/(app)/sales/document-actions";
import { DocumentActionBar } from "@/components/documents/document-action-bar";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { customerNiuWarning } from "@/lib/customers/niu";
import {
  computeBuilderTotals,
  dueDateFromTerms,
  toDocumentPayload,
  type BuilderState,
  type BuilderTaxRate,
  type BuilderWithholdingType,
} from "@/lib/documents/builder-model";
import {
  DOCUMENT_TYPE_LABELS,
  isReceivableType,
  type BuilderDocumentType,
  type DocumentActions,
} from "@/lib/documents/status";
import { CURRENCY_CODES } from "@/lib/finance/money";
import { addDaysISO, isValidISODate } from "@/lib/utils/date-math";
import { DISCOUNT_TYPES, type ApprovalStatus, type DocumentStatus } from "@/types/database";
import { LinesEditor } from "./lines-editor";
import { QuickAddCustomerDialog } from "./quick-add-customer-dialog";
import { TotalsPanel } from "./totals-panel";
import type { BuilderCatalogItem, BuilderCustomer, BuilderDefaults } from "./types";

function Field({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className ?? "space-y-1.5"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function DocumentBuilder({
  documentType,
  documentId,
  initial,
  approval,
  status = "draft",
  documentNumber = null,
  customers,
  catalog,
  taxRates,
  withholdingTypes = [],
  vatEnabled,
  defaults,
  actions,
  canSave,
}: {
  documentType: BuilderDocumentType;
  /** null while creating a new document. */
  documentId: string | null;
  initial: BuilderState;
  approval: { status: ApprovalStatus; note: string | null } | null;
  /** Current persisted status — drafts can still be issued; issued docs save in place. */
  status?: DocumentStatus;
  documentNumber?: string | null;
  customers: BuilderCustomer[];
  catalog: BuilderCatalogItem[];
  taxRates: BuilderTaxRate[];
  withholdingTypes?: BuilderWithholdingType[];
  /** Company is VAT-registered (Settings → Tax). Per-document apply is controlled below. */
  vatEnabled: boolean;
  defaults: BuilderDefaults;
  actions: DocumentActions;
  canSave: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<BuilderState>(initial);
  const [customerList, setCustomerList] = useState(customers);
  const [catalogList, setCatalogList] = useState(catalog);
  const [dirty, setDirty] = useState(documentId === null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const [currentId, setCurrentId] = useState<string | null>(documentId);
  // Per-document choice: new docs default ON when the company can charge VAT; existing drafts follow their lines.
  const [applyVat, setApplyVat] = useState(() => {
    if (!vatEnabled) return false;
    if (initial.lines.length === 0) return true;
    return initial.lines.some((line) => line.taxRateId != null);
  });
  const idRef = useRef<string | null>(documentId);
  const stateRef = useRef(state);
  stateRef.current = state;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const applyVatRef = useRef(applyVat);
  applyVatRef.current = applyVat;

  const label = DOCUMENT_TYPE_LABELS[documentType];
  const isDraft = status === "draft";
  const customer = customerList.find((c) => c.id === state.customerId) ?? null;
  const niuWarning = customer ? customerNiuWarning(customer) : null;
  const totals = useMemo(
    () => computeBuilderTotals(state, taxRates, applyVat, withholdingTypes),
    [state, taxRates, applyVat, withholdingTypes],
  );
  const receivable = isReceivableType(documentType);
  const editable = canSave;
  const lineTaxRateId = applyVat ? defaults.defaultTaxRateId : null;
  const defaultVatRate = defaults.defaultTaxRateId
    ? (taxRates.find((r) => r.id === defaults.defaultTaxRateId)?.rate ?? null)
    : null;

  const patch = useCallback((changes: Partial<BuilderState>) => {
    setState((current) => ({ ...current, ...changes }));
    setDirty(true);
  }, []);

  function onApplyVatChange(next: boolean) {
    if (!vatEnabled) return;
    setApplyVat(next);
    const taxRateId = next ? defaults.defaultTaxRateId : null;
    setState((current) => ({
      ...current,
      lines: current.lines.map((line) => ({ ...line, taxRateId })),
    }));
    setDirty(true);
  }

  function applyCustomer(picked: BuilderCustomer | undefined, customerId: string) {
    const changes: Partial<BuilderState> = { customerId };
    if (picked) {
      // Defaults only; the user can still override both.
      changes.currency = picked.default_currency;
      const terms = String(picked.payment_terms_days ?? defaults.paymentTermsDays);
      changes.paymentTermsDays = terms;
      if (receivable) changes.dueDate = dueDateFromTerms(state.issueDate, terms) ?? state.dueDate;
    }
    patch(changes);
  }

  function onCustomerChange(customerId: string) {
    applyCustomer(
      customerList.find((c) => c.id === customerId),
      customerId,
    );
  }

  function onIssueDateChange(issueDate: string) {
    const changes: Partial<BuilderState> = { issueDate };
    if (receivable) changes.dueDate = dueDateFromTerms(issueDate, state.paymentTermsDays) ?? state.dueDate;
    else if (isValidISODate(issueDate)) changes.validUntil = addDaysISO(issueDate, defaults.validityDays);
    patch(changes);
  }

  function onTermsChange(paymentTermsDays: string) {
    const due = dueDateFromTerms(state.issueDate, paymentTermsDays);
    patch({ paymentTermsDays, ...(due ? { dueDate: due } : {}) });
  }

  /** Persist the editor. Resolves to the document id, or null when validation/saving failed. */
  const ensureSaved = useCallback(async (): Promise<string | null> => {
    if (idRef.current && !dirtyRef.current) return idRef.current;
    const payload = toDocumentPayload(documentType, stateRef.current);
    if (!applyVatRef.current) {
      payload.lines = payload.lines.map((line) => ({ ...line, taxRateId: null }));
    } else if (defaults.defaultTaxRateId) {
      // Keep a single document-level rate: any line without a rate gets the company default.
      payload.lines = payload.lines.map((line) => ({
        ...line,
        taxRateId: line.taxRateId ?? defaults.defaultTaxRateId,
      }));
    }
    const result = await saveDraftAction(payload, idRef.current);
    if (!result.ok) {
      setServerErrors(result.fieldErrors ?? {});
      toast.error(result.error, { description: result.details?.join("\n") });
      return null;
    }
    setServerErrors({});
    setDirty(false);
    dirtyRef.current = false;
    const wasNew = idRef.current === null;
    idRef.current = result.data.id;
    setCurrentId(result.data.id);
    if (result.data.pdfError) {
      toast.error("Saved, but the PDF could not be regenerated yet", { description: result.data.pdfError });
    }
    if (wasNew) router.replace(result.data.href);
    return result.data.id;
  }, [defaults.defaultTaxRateId, documentType, router]);

  function save() {
    startSaving(async () => {
      const id = await ensureSaved();
      if (id) {
        toast.success(isDraft ? "Draft saved" : "Changes saved", {
          description: isDraft
            ? "Keep editing if needed, then click Issue when you are ready."
            : "The official number is unchanged. The PDF was regenerated.",
        });
        router.refresh();
      }
    });
  }

  const errorList = Object.entries(serverErrors).filter(([key]) => !key.startsWith("lines."));
  const customerOptions = customerList.filter((c) => c.is_active || c.id === state.customerId);

  function onCustomerCreated(created: BuilderCustomer) {
    setCustomerList((list) => (list.some((c) => c.id === created.id) ? list : [created, ...list]));
    applyCustomer(created, created.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <DocumentStatusBadge status={status} />
          <span className="text-sm text-muted-foreground">
            {isDraft
              ? `${label} draft — no official number until it is issued`
              : `${label} ${documentNumber ?? ""} — edits keep this number`.trim()}
          </span>
          {approval && approval.status !== "none" && (
            <span className="text-sm">
              Approval: <strong className="capitalize">{approval.status}</strong>
              {approval.note ? ` - ${approval.note}` : ""}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <Button type="button" size="sm" variant="secondary" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
              {isDraft ? "Save draft" : "Save changes"}
            </Button>
          )}
        </div>
      </div>

      <DocumentActionBar
        documentId={currentId}
        documentType={documentType}
        actions={actions}
        ensureSaved={ensureSaved}
        disabled={saving}
        emphasizeIssue={isDraft}
      />

      {errorList.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-4">
              {errorList.map(([key, message]) => (
                <li key={key}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer and dates</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5 md:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="b-customer">Customer</Label>
              {editable && (
                <QuickAddCustomerDialog
                  onCreated={onCustomerCreated}
                  trigger={
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      <UserPlus className="size-3" aria-hidden /> New customer
                    </Button>
                  }
                />
              )}
            </div>
            <NativeSelect
              id="b-customer"
              value={state.customerId}
              disabled={!editable}
              aria-invalid={Boolean(serverErrors.customerId)}
              onChange={(e) => onCustomerChange(e.target.value)}
            >
              <option value="">Select a customer...</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.niu ? ` (NIU ${c.niu})` : ""}
                </option>
              ))}
            </NativeSelect>
            {serverErrors.customerId && <p className="text-xs text-destructive">{serverErrors.customerId}</p>}
            {niuWarning && (
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {niuWarning} You can still continue.
              </p>
            )}
          </div>

          <Field label="Currency" htmlFor="b-currency">
            <NativeSelect
              id="b-currency"
              value={state.currency}
              disabled={!editable}
              onChange={(e) => patch({ currency: e.target.value as BuilderState["currency"] })}
            >
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Issue date" htmlFor="b-issue">
            <Input
              id="b-issue"
              type="date"
              value={state.issueDate}
              disabled={!editable}
              aria-invalid={Boolean(serverErrors.issueDate)}
              onChange={(e) => onIssueDateChange(e.target.value)}
            />
          </Field>

          {receivable ? (
            <>
              <Field label="Payment terms (days)" htmlFor="b-terms-days">
                <Input
                  id="b-terms-days"
                  inputMode="numeric"
                  value={state.paymentTermsDays}
                  disabled={!editable}
                  onChange={(e) => onTermsChange(e.target.value)}
                />
              </Field>
              <Field label="Due date" htmlFor="b-due">
                <Input
                  id="b-due"
                  type="date"
                  value={state.dueDate}
                  disabled={!editable}
                  aria-invalid={Boolean(serverErrors.dueDate)}
                  onChange={(e) => patch({ dueDate: e.target.value })}
                />
                {serverErrors.dueDate && <p className="text-xs text-destructive">{serverErrors.dueDate}</p>}
              </Field>
            </>
          ) : (
            <Field label="Valid until" htmlFor="b-valid">
              <Input
                id="b-valid"
                type="date"
                value={state.validUntil}
                disabled={!editable}
                aria-invalid={Boolean(serverErrors.validUntil)}
                onChange={(e) => patch({ validUntil: e.target.value })}
              />
              {serverErrors.validUntil && <p className="text-xs text-destructive">{serverErrors.validUntil}</p>}
            </Field>
          )}

          <Field label="Reference / PO number" htmlFor="b-reference">
            <Input id="b-reference" value={state.reference} disabled={!editable} onChange={(e) => patch({ reference: e.target.value })} />
          </Field>
          <Field label="Subject" htmlFor="b-subject" className="space-y-1.5 md:col-span-2">
            <Input id="b-subject" value={state.subject} disabled={!editable} onChange={(e) => patch({ subject: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LinesEditor
            lines={state.lines}
            results={totals.lineResults}
            defaultTaxRateId={lineTaxRateId}
            catalog={catalogList}
            currency={state.currency}
            disabled={!editable}
            errors={serverErrors}
            onChange={(lines) => patch({ lines })}
            onCatalogItemAdded={(item) =>
              setCatalogList((list) => (list.some((c) => c.id === item.id) ? list : [item, ...list]))
            }
          />
          {serverErrors.lines && <p className="text-xs text-destructive">{serverErrors.lines}</p>}
          <p className="text-xs text-muted-foreground">
            Line amounts are HT
            {applyVat
              ? `. VAT is added once in the totals${defaultVatRate != null ? ` at ${defaultVatRate}%` : ""}.`
              : " (no VAT on this document)."}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes and terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Notes (printed)" htmlFor="b-notes">
              <Textarea id="b-notes" rows={3} value={state.notes} disabled={!editable} onChange={(e) => patch({ notes: e.target.value })} />
            </Field>
            <Field label="Terms and conditions (printed)" htmlFor="b-terms">
              <Textarea id="b-terms" rows={3} value={state.terms} disabled={!editable} onChange={(e) => patch({ terms: e.target.value })} />
            </Field>
            <Field label="Internal notes (never printed)" htmlFor="b-internal">
              <Textarea
                id="b-internal"
                rows={2}
                value={state.internalNotes}
                disabled={!editable}
                onChange={(e) => patch({ internalNotes: e.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {vatEnabled ? (
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                <div className="min-w-0">
                  <Label htmlFor="b-apply-vat" className="text-sm font-medium">
                    Apply VAT{defaultVatRate != null ? ` (${defaultVatRate}%)` : ""}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Optional for this document. Off = total equals HT (exempt).
                  </p>
                </div>
                <Switch
                  id="b-apply-vat"
                  checked={applyVat}
                  disabled={!editable}
                  onCheckedChange={onApplyVatChange}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                VAT is turned off in Settings &gt; Tax for the whole company.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Global discount" htmlFor="b-gd-type">
                <NativeSelect
                  id="b-gd-type"
                  value={state.globalDiscountType}
                  disabled={!editable}
                  onChange={(e) =>
                    patch({
                      globalDiscountType: e.target.value as BuilderState["globalDiscountType"],
                      globalDiscountValue: e.target.value === "none" ? "0" : state.globalDiscountValue,
                    })
                  }
                >
                  {DISCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === "none" ? "None" : t === "percentage" ? "Percentage (%)" : "Fixed amount"}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Value" htmlFor="b-gd-value">
                <Input
                  id="b-gd-value"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  value={state.globalDiscountType === "none" ? "" : state.globalDiscountValue}
                  disabled={!editable || state.globalDiscountType === "none"}
                  aria-invalid={Boolean(serverErrors.globalDiscountValue)}
                  onChange={(e) => patch({ globalDiscountValue: e.target.value })}
                />
              </Field>
            </div>

            {withholdingTypes.length > 0 && (
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Withholding (optional)</legend>
                {withholdingTypes.map((w) => {
                  const checked = state.withholdingTypeIds.includes(w.id);
                  return (
                    <label key={w.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input accent-primary"
                        checked={checked}
                        disabled={!editable}
                        onChange={(e) =>
                          patch({
                            withholdingTypeIds: e.target.checked
                              ? [...state.withholdingTypeIds, w.id]
                              : state.withholdingTypeIds.filter((id) => id !== w.id),
                          })
                        }
                      />
                      {w.code} - {w.name} ({w.rate}% of {w.base === "net_ht" ? "total HT" : w.base === "total_ttc" ? "total TTC" : "VAT"})
                    </label>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  Withholding reduces the net amount payable in cash. The invoice total TTC and VAT do not change.
                </p>
              </fieldset>
            )}

            <TotalsPanel totals={totals.calc} currency={state.currency} vatEnabled={applyVat} />

            {totals.error && <p className="text-xs text-destructive">{totals.error}</p>}
            {totals.incompleteLines.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Line {totals.incompleteLines.join(", ")} not counted yet (check quantity, price and discount).
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Preview only: the server recalculates every amount when you save and again when you issue.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
