import type { Metadata } from "next";
import { DocumentNewPage } from "@/components/documents/pages/document-new-page";
import type { RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "New advance invoice" };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return <DocumentNewPage type="advance" searchParams={await searchParams} />;
}
