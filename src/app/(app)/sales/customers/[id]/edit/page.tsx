import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/customers/customer-form";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageRepo } from "@/lib/data/page";

export const metadata: Metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo } = await requirePageRepo("customers.update");
  const customer = await repo.customers.get(id);
  if (!customer) notFound();

  return (
    <>
      <PageHeader title={`Edit ${customer.name}`} description="Changes apply to new documents only - issued documents keep their snapshot." />
      <CustomerForm
        customerId={customer.id}
        defaultValues={{
          customer_type: customer.customer_type,
          name: customer.name,
          code: customer.code ?? "",
          contact_name: customer.contact_name ?? "",
          email: customer.email ?? "",
          phone: customer.phone ?? "",
          address_line1: customer.address_line1 ?? "",
          address_line2: customer.address_line2 ?? "",
          city: customer.city ?? "",
          region: customer.region ?? "",
          country: customer.country,
          niu: customer.niu ?? "",
          rccm: customer.rccm ?? "",
          default_currency: customer.default_currency,
          payment_terms_days: customer.payment_terms_days === null ? "" : String(customer.payment_terms_days),
          notes: customer.notes ?? "",
          is_active: customer.is_active,
        }}
      />
    </>
  );
}
