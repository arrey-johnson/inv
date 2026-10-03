import "server-only";
import { getServerEnv, isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PdfRenderAssets } from "@/lib/pdf/types";
import type { BrandAssetKind } from "@/types/database";
import { readLocalLetterhead, readLocalStamp, sha256Hex } from "./local-branding";
import { validateLetterheadPdf, validateStampPng, type AssetValidation } from "./validate-brand-asset";

export type BrandingSource = "storage" | "local";

export interface LoadedBranding extends PdfRenderAssets {
  source: BrandingSource;
}

export class BrandingAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandingAssetError";
  }
}

async function downloadActiveAsset(organizationId: string, kind: BrandAssetKind): Promise<Uint8Array | null> {
  const admin = createAdminClient();
  const { data: asset, error } = await admin
    .from("brand_assets")
    .select("storage_bucket, storage_path")
    .eq("organization_id", organizationId)
    .eq("kind", kind)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new BrandingAssetError(`Could not look up the ${kind} asset: ${error.message}`);
  if (!asset) return null;

  const { data, error: downloadError } = await admin.storage.from(asset.storage_bucket).download(asset.storage_path);
  if (downloadError || !data) {
    throw new BrandingAssetError(`Could not download the ${kind} from storage: ${downloadError?.message ?? "empty"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Load the official letterhead + stamp for PDF rendering (server only).
 *
 *  - BRANDING_SOURCE=storage : private Supabase bucket via active `brand_assets` rows (production).
 *  - BRANDING_SOURCE=local   : files in assets/branding/source (local development default).
 *
 * The letterhead is mandatory. The stamp is optional: when it is missing the document renders
 * without one and `stampPng` is null (callers decide whether that is acceptable for issued documents).
 */
export async function loadBrandingAssets(organizationId: string): Promise<LoadedBranding> {
  // Demo mode has no Supabase and no server secrets: always use the local files.
  const BRANDING_SOURCE: BrandingSource = isDemoMode() ? "local" : getServerEnv().BRANDING_SOURCE;

  if (BRANDING_SOURCE === "storage") {
    const [letterheadPdf, stampPng] = await Promise.all([
      downloadActiveAsset(organizationId, "letterhead"),
      downloadActiveAsset(organizationId, "stamp"),
    ]);
    if (!letterheadPdf) throw new BrandingAssetError("No active letterhead uploaded. Upload one in Settings - Branding.");
    return { letterheadPdf, stampPng, source: "storage" };
  }

  const [letterheadPdf, stampPng] = await Promise.all([readLocalLetterhead(), readLocalStamp()]);
  if (!letterheadPdf) {
    throw new BrandingAssetError("assets/branding/source/letterhead-promptstack.pdf is missing.");
  }
  return { letterheadPdf, stampPng, source: "local" };
}

export interface BrandingAssetStatus {
  kind: "letterhead" | "stamp";
  present: boolean;
  source: BrandingSource | null;
  sha256: string | null;
  validation: AssetValidation | null;
}

/** Diagnostic used by the Branding settings page. Never exposes the bytes. */
export async function getBrandingStatus(organizationId: string): Promise<{
  configuredSource: BrandingSource;
  assets: BrandingAssetStatus[];
}> {
  const configuredSource = getBrandingSource();
  const assets: BrandingAssetStatus[] = [];

  let letterhead: Uint8Array | null = null;
  let stamp: Uint8Array | null = null;
  try {
    if (configuredSource === "storage") {
      [letterhead, stamp] = await Promise.all([
        downloadActiveAsset(organizationId, "letterhead"),
        downloadActiveAsset(organizationId, "stamp"),
      ]);
    } else {
      [letterhead, stamp] = await Promise.all([readLocalLetterhead(), readLocalStamp()]);
    }
  } catch {
    // fall through: assets reported as missing
  }

  assets.push({
    kind: "letterhead",
    present: Boolean(letterhead),
    source: letterhead ? configuredSource : null,
    sha256: letterhead ? sha256Hex(letterhead).slice(0, 16) : null,
    validation: letterhead ? await validateLetterheadPdf(letterhead) : null,
  });
  assets.push({
    kind: "stamp",
    present: Boolean(stamp),
    source: stamp ? configuredSource : null,
    sha256: stamp ? sha256Hex(stamp).slice(0, 16) : null,
    validation: stamp ? validateStampPng(stamp) : null,
  });

  return { configuredSource, assets };
}

/** Configured source without throwing when server env is incomplete. */
export function getBrandingSource(): BrandingSource {
  if (isDemoMode()) return "local";
  try {
    return getServerEnv().BRANDING_SOURCE;
  } catch {
    return process.env.BRANDING_SOURCE === "storage" ? "storage" : "local";
  }
}
