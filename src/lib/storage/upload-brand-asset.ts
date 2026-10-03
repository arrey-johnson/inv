import "server-only";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BrandAssetKind } from "@/types/database";

type UploadableKind = Extract<BrandAssetKind, "letterhead" | "stamp">;
import { writeLocalUpload, sha256Hex } from "./local-branding";
import {
  BRAND_ASSET_LIMITS,
  validateLetterheadPdf,
  validateStampPng,
  type AssetValidation,
} from "./validate-brand-asset";
import { getBrandingSource } from "./branding";

export class BrandUploadError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "BrandUploadError";
  }
}

export async function validateBrandUpload(kind: UploadableKind, bytes: Uint8Array): Promise<AssetValidation> {
  const max = kind === "letterhead" ? BRAND_ASSET_LIMITS.letterheadMaxBytes : BRAND_ASSET_LIMITS.stampMaxBytes;
  if (bytes.length === 0) return { ok: false, errors: ["The file is empty."], info: {} };
  if (bytes.length > max) {
    return { ok: false, errors: [`The file is larger than ${Math.round(max / 1024 / 1024)} MB.`], info: { bytes: bytes.length } };
  }
  return kind === "letterhead" ? validateLetterheadPdf(bytes) : validateStampPng(bytes);
}

/**
 * Persist a validated letterhead/stamp.
 *  - Supabase configured: private `branding` bucket + a new versioned `brand_assets` row (the previous
 *    version stays in storage and is deactivated, so history is kept).
 *  - Demo / local: `.data/branding/` (gitignored, outside /public). Documented local fallback.
 * Returns where the file went.
 */
export async function storeBrandAsset(input: {
  organizationId: string;
  userId: string | null;
  kind: UploadableKind;
  bytes: Uint8Array;
  fileName: string;
}): Promise<{ target: "storage" | "local"; sha256: string }> {
  const validation = await validateBrandUpload(input.kind, input.bytes);
  if (!validation.ok) throw new BrandUploadError("The file was rejected.", validation.errors);
  const sha256 = sha256Hex(input.bytes);

  if (isDemoMode() || getBrandingSource() === "local") {
    await writeLocalUpload(input.kind, input.bytes);
    return { target: "local", sha256 };
  }

  const admin = createAdminClient();
  const { data: versions, error: versionError } = await admin
    .from("brand_assets")
    .select("id, version, is_active")
    .eq("organization_id", input.organizationId)
    .eq("kind", input.kind)
    .order("version", { ascending: false });
  if (versionError) throw new BrandUploadError(`Could not read asset history: ${versionError.message}`);

  const version = (versions?.[0]?.version ?? 0) + 1;
  const extension = input.kind === "letterhead" ? "pdf" : "png";
  const mimeType = input.kind === "letterhead" ? "application/pdf" : "image/png";
  const storagePath = `${input.organizationId}/${input.kind}/v${version}-${sha256.slice(0, 12)}.${extension}`;

  const { error: uploadError } = await admin.storage
    .from("branding")
    .upload(storagePath, input.bytes, { contentType: mimeType, upsert: false });
  if (uploadError) throw new BrandUploadError(`Upload failed: ${uploadError.message}`);

  const previousActive = (versions ?? []).filter((v) => v.is_active).map((v) => v.id);
  if (previousActive.length > 0) {
    const { error } = await admin.from("brand_assets").update({ is_active: false }).in("id", previousActive);
    if (error) throw new BrandUploadError(`Could not retire the previous version: ${error.message}`);
  }

  const { error: insertError } = await admin.from("brand_assets").insert({
    organization_id: input.organizationId,
    kind: input.kind,
    storage_bucket: "branding",
    storage_path: storagePath,
    file_name: input.fileName.slice(0, 200),
    mime_type: mimeType,
    byte_size: input.bytes.length,
    sha256,
    version,
    is_active: true,
    uploaded_by: input.userId,
  });
  if (insertError) {
    // Roll back to the previous active version so documents keep rendering.
    if (previousActive.length > 0) await admin.from("brand_assets").update({ is_active: true }).in("id", previousActive);
    throw new BrandUploadError(`Could not record the new asset: ${insertError.message}`);
  }

  return { target: "storage", sha256 };
}
