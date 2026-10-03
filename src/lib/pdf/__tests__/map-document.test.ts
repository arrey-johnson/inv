import { describe, expect, it } from "vitest";
import { calculateDocument } from "@/lib/finance/calculate-document";
import type { DocumentItem, DocumentRow } from "@/types/database";
import { bankFromSnapshot, buildPdfDocumentData, calcFromStored, discountLabel, partyFromSnapshot } from "../map-document";

function makeDoc(overrides: Partial<DocumentRow> = {}): DocumentRow {
  const calc = calculateDocument({
    lines: [
      { quantity: 1, unitPrice: 101, taxRate: 19.25 },
      { quantity: 1, unitPrice: 101, taxRate: 19.25 },
      { quantity: 1, unitPrice: 101, taxRate: 19.25 },
    ],
  });
  return {
    id: "d1", organization_id: "o1", document_type: "invoice", status: "issued", number: "PS-INV-2026-0001",
    customer_id: "c1", customer_snapshot: { name: "Acme", address_line1: "Rue 1", city: "Douala", country: "Cameroon", niu: null },
    issuer_snapshot: { legal_name: "Promptstack Technologies", bank_name: null, niu: null },
    issue_date: "2026-10-02", due_date: "2026-11-01", valid_until: null, currency: "XAF", reference: "PO-9",
    subject: null, notes: "n", terms: null, internal_notes: null,
    global_discount_type: "none", global_discount_value: 0, subtotal: calc.subtotal, line_discount_total: 0,
    global_discount_amount: 0, net_ht: calc.netHT, tax_total: calc.taxTotal, total_ttc: calc.totalTTC,
    withholding_total: 0, net_payable: calc.netPayable, paid_amount: 100, credited_amount: 0,
    advance_applied_amount: 0, balance_due: calc.netPayable - 100,
    issued_at: null, issued_by: null, sent_at: null, voided_at: null, voided_by: null, void_reason: null,
    converted_from_document_id: null, public_token_hash: null, public_token_created_at: null,
    public_token_expires_at: null, public_token_revoked_at: null, pdf_storage_path: null, pdf_sha256: null,
    pdf_generated_at: null, approval_status: "none", approval_requested_by: null, approval_requested_at: null,
    approved_by: null, approved_at: null, approval_note: null, created_by: null, updated_by: null, created_at: "", updated_at: "", deleted_at: null,
    ...overrides,
  };
}

function makeItems(): DocumentItem[] {
  const calc = calculateDocument({
    lines: [1, 2, 3].map(() => ({ quantity: 1, unitPrice: 101, taxRate: 19.25 })),
  });
  return calc.lines.map((l, i) => ({
    id: `i${i}`, organization_id: "o1", document_id: "d1", position: i + 1, item_id: null,
    description: `Line ${i + 1}`, details: null, quantity: l.quantity, unit: null, unit_price: l.unitPrice,
    discount_type: "none", discount_value: 0, tax_rate_id: null, tax_rate: l.taxRate, tax_category: "standard",
    gross_amount: l.grossAmount, discount_amount: l.discountAmount, net_amount: l.netAmount,
    global_discount_share: l.globalDiscountShare, taxable_amount: l.taxableAmount, tax_amount: l.taxAmount,
    total_amount: l.totalAmount, credit_source_item_id: null, created_at: "", updated_at: "",
  }));
}

describe("map-document", () => {
  it("rebuilds the exact engine result from stored rows (VAT grouped by rate)", () => {
    const stored = calcFromStored(makeDoc(), makeItems(), []);
    const fresh = calculateDocument({ lines: [1, 2, 3].map(() => ({ quantity: 1, unitPrice: 101, taxRate: 19.25 })) });
    expect(stored.taxBreakdown).toEqual(fresh.taxBreakdown);
    expect(stored.totalTTC).toBe(fresh.totalTTC);
    expect(stored.lines.map((l) => l.taxAmount)).toEqual(fresh.lines.map((l) => l.taxAmount));
  });

  it("builds renderer data from a snapshot and omits unset identifiers", () => {
    const data = buildPdfDocumentData({
      document: makeDoc(),
      items: makeItems(),
      withholdings: [],
      customer: partyFromSnapshot(makeDoc().customer_snapshot, "Customer"),
      issuer: partyFromSnapshot(makeDoc().issuer_snapshot, "Issuer"),
      bank: bankFromSnapshot(makeDoc().issuer_snapshot),
    });
    expect(data.number).toBe("PS-INV-2026-0001");
    expect(data.issuer.niu).toBeNull();
    expect(data.issuer.rccm).toBeNull();
    expect(data.bank).toBeNull(); // no invented bank details
    expect(data.customer.addressLines).toContain("Rue 1");
    expect(data.metaRows).toContainEqual({ label: "Reference", value: "PO-9" });
    expect(data.settlement).toEqual({ paidAmount: 100, balanceDue: 361 - 100 });
  });

  it("labels discounts", () => {
    expect(discountLabel({ discount_type: "none", discount_value: 0, discount_amount: 0 })).toBeNull();
    expect(discountLabel({ discount_type: "percentage", discount_value: 10, discount_amount: 500 })).toBe("10%");
    expect(discountLabel({ discount_type: "fixed", discount_value: 5000, discount_amount: 5000 })).toBe("5,000");
  });

  it("does not expose draft settlement", () => {
    const data = buildPdfDocumentData({
      document: makeDoc({ status: "draft", number: null }),
      items: makeItems(),
      withholdings: [],
      customer: { name: "Acme" },
      issuer: { name: "Promptstack" },
    });
    expect(data.settlement).toBeNull();
    expect(data.number).toBe("DRAFT");
  });
});
