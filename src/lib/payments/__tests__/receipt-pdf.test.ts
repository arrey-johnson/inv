import { describe, expect, it } from "vitest";
import type { PaymentDetail } from "@/lib/data/types";
import type { Customer, Payment, PaymentAllocation } from "@/types/database";
import { buildPaymentReceiptPdfData, paymentReceiptNumber } from "../receipt-pdf";

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    organization_id: "o1",
    customer_id: "c1",
    payment_date: "2026-10-06",
    amount: 150_000,
    currency: "XAF",
    method: "bank_transfer",
    reference: "TRX-99",
    notes: "Thank you",
    receipt_document_id: null,
    is_adjustment: false,
    adjustment_reason: null,
    received_by: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_by: null,
    created_at: "2026-10-06T10:00:00.000Z",
    updated_at: "2026-10-06T10:00:00.000Z",
    ...overrides,
  };
}

function makeCustomer(): Customer {
  return {
    id: "c1",
    organization_id: "o1",
    customer_type: "company",
    code: null,
    name: "AmCham Cameroon",
    contact_name: null,
    email: "billing@example.com",
    phone: "+237600000000",
    address_line1: "Douala",
    address_line2: null,
    city: "Douala",
    region: null,
    country: "Cameroon",
    niu: "M123",
    rccm: null,
    default_currency: "XAF",
    payment_terms_days: 30,
    default_withholding_type_id: null,
    notes: null,
    is_active: true,
    created_by: null,
    created_at: "",
    updated_at: "",
    deleted_at: null,
  };
}

function makeAllocation(amount: number, number: string): PaymentDetail["allocations"][number] {
  const allocation: PaymentAllocation = {
    id: `a-${amount}`,
    organization_id: "o1",
    payment_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    document_id: `d-${number}`,
    amount,
    created_at: "",
  };
  return {
    allocation,
    document: {
      id: `d-${number}`,
      organization_id: "o1",
      document_type: "invoice",
      status: "paid",
      number,
      customer_id: "c1",
      customer_snapshot: null,
      issuer_snapshot: null,
      issue_date: "2026-10-01",
      due_date: "2026-10-31",
      valid_until: null,
      currency: "XAF",
      reference: null,
      subject: "Consulting",
      notes: null,
      terms: null,
      internal_notes: null,
      global_discount_type: "none",
      global_discount_value: 0,
      subtotal: amount,
      line_discount_total: 0,
      global_discount_amount: 0,
      net_ht: amount,
      tax_total: 0,
      total_ttc: amount,
      withholding_total: 0,
      net_payable: amount,
      paid_amount: amount,
      credited_amount: 0,
      advance_applied_amount: 0,
      balance_due: 0,
      issued_at: null,
      issued_by: null,
      sent_at: null,
      voided_at: null,
      voided_by: null,
      void_reason: null,
      converted_from_document_id: null,
      public_token_hash: null,
      public_token_created_at: null,
      public_token_expires_at: null,
      public_token_revoked_at: null,
      pdf_storage_path: null,
      pdf_sha256: null,
      pdf_generated_at: null,
      approval_status: "none",
      approval_requested_by: null,
      approval_requested_at: null,
      approved_by: null,
      approved_at: null,
      approval_note: null,
      created_by: null,
      updated_by: null,
      created_at: "",
      updated_at: "",
      deleted_at: null,
    },
  };
}

describe("payment receipt PDF mapping", () => {
  it("builds a stamped receipt with allocation lines and method meta", () => {
    const detail: PaymentDetail = {
      payment: makePayment(),
      customer: makeCustomer(),
      allocations: [makeAllocation(100_000, "PS-INV-2026-0001"), makeAllocation(50_000, "PS-INV-2026-0002")],
    };
    const data = buildPaymentReceiptPdfData(detail, { name: "Promptstack Technologies" });

    expect(data.type).toBe("receipt");
    expect(data.status).toBe("issued");
    expect(data.number).toBe(paymentReceiptNumber(detail.payment));
    expect(data.customer.name).toBe("AmCham Cameroon");
    expect(data.lines).toHaveLength(2);
    expect(data.lines[0]?.description).toContain("PS-INV-2026-0001");
    expect(data.calc.totalTTC).toBe(150_000);
    expect(data.calc.taxTotal).toBe(0);
    expect(data.metaRows?.some((r) => r.label === "Payment method" && r.value === "Bank transfer")).toBe(true);
    expect(data.metaRows?.some((r) => r.label === "Reference" && r.value === "TRX-99")).toBe(true);
  });

  it("marks voided payments as CANCELLED (no stamp)", () => {
    const detail: PaymentDetail = {
      payment: makePayment({
        voided_at: "2026-10-07T12:00:00.000Z",
        void_reason: "Duplicate entry",
      }),
      customer: makeCustomer(),
      allocations: [makeAllocation(150_000, "PS-INV-2026-0001")],
    };
    const data = buildPaymentReceiptPdfData(detail, { name: "Promptstack Technologies" });
    expect(data.status).toBe("void");
    expect(data.metaRows?.some((r) => r.label === "Cancelled")).toBe(true);
  });
});
