import type { Metadata } from "next";
import { DocumentDetailPage } from "@/components/documents/pages/document-detail-page";
import type { RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Advance invoice" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  return <DocumentDetailPage type="advance" id={id} searchParams={await searchParams} />;
}
