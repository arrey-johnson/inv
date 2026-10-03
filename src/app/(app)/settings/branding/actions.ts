"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, invalidInput, isFailure, succeed, type ActionResult } from "@/lib/actions/helpers";
import { BrandUploadError, storeBrandAsset } from "@/lib/storage/upload-brand-asset";
import { brandingSettingsSchema } from "@/lib/validations/settings";

export async function saveBrandingSettingsAction(input: unknown): Promise<ActionResult> {
  const auth = await authorize("settings.branding.manage");
  if (isFailure(auth)) return auth;
  const parsed = brandingSettingsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const { stamp_x, stamp_y, stamp_width } = parsed.data;
  // The three stamp coordinates only make sense together; partial values would silently fall back.
  const provided = [stamp_x, stamp_y, stamp_width].filter((v) => v !== null).length;
  if (provided !== 0 && provided !== 3) {
    return {
      ok: false,
      error: "Set X, Y and width together, or leave all three empty for the default placement.",
      fieldErrors: { stamp_x: "Fill X, Y and width together" },
    };
  }

  try {
    const before = await auth.repo.organization.getSettings();
    const after = await auth.repo.organization.updateSettings(parsed.data);
    await auth.repo.writeAudit({
      action: "settings.branding.update",
      entityType: "organization_settings",
      before: before ? { ...before } : null,
      after: { ...after },
    });
    revalidatePath("/settings/branding");
    revalidatePath("/sales", "layout");
    return succeed(null);
  } catch (error) {
    return failure(error);
  }
}

export async function uploadBrandAssetAction(formData: FormData): Promise<ActionResult<{ target: "storage" | "local" }>> {
  const auth = await authorize("settings.branding.manage");
  if (isFailure(auth)) return auth;

  const kind = formData.get("kind");
  const file = formData.get("file");
  if (kind !== "letterhead" && kind !== "stamp") return { ok: false, error: "Unknown asset type." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to upload." };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stored = await storeBrandAsset({
      organizationId: auth.ctx.organizationId,
      userId: auth.ctx.user.id,
      kind,
      bytes,
      fileName: file.name,
    });
    await auth.repo.writeAudit({
      action: "settings.branding.update",
      entityType: "brand_asset",
      metadata: { kind, sha256: stored.sha256, target: stored.target, bytes: bytes.length },
    });
    revalidatePath("/settings/branding");
    return succeed({ target: stored.target });
  } catch (error) {
    if (error instanceof BrandUploadError) return { ok: false, error: error.message, details: error.details };
    return failure(error);
  }
}
