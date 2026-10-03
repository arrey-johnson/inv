import type { Metadata } from "next";
import { DocumentListPage } from "@/components/documents/pages/document-list-page";
import type { RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Credit notes" };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return <DocumentListPage type="credit_note" searchParams={await searchParams} />;
}
