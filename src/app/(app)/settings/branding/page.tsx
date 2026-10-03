import type { Metadata } from "next";
import { CheckCircle2, FileImage, FileText, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { BRAND } from "@/lib/pdf/layout";
import { getBrandingStatus } from "@/lib/storage/branding";
import { BrandingSettingsForm } from "./branding-settings-form";
import { UploadAssetForm } from "./upload-asset-form";

export const metadata: Metadata = { title: "Branding settings" };
export const dynamic = "force-dynamic";

const ASSET_COPY = {
  letterhead: {
    title: "Letterhead (PDF background)",
    description: "Single-page A4 PDF drawn behind every page of every document.",
    icon: FileText,
  },
  stamp: {
    title: "Company stamp (PNG)",
    description: "Applied on the last page of issued documents. Never shown for drafts or voided documents.",
    icon: FileImage,
  },
} as const;

export default async function BrandingSettingsPage() {
  const { ctx, repo } = await requirePageRepo("settings.view");
  const [status, settings] = await Promise.all([getBrandingStatus(ctx.organizationId), repo.organization.getSettings()]);
  const canEdit = hasPermission(ctx.role, "settings.branding.manage");

  return (
    <>
      <PageHeader
        title="Branding"
        description="Official letterhead and stamp used by the PDF renderer. Files are private and only read on the server."
      />

      <Alert>
        <AlertTitle>
          Source: {status.configuredSource === "storage" ? "Private Supabase Storage" : "Local files (development)"}
        </AlertTitle>
        <AlertDescription>
          {status.configuredSource === "storage"
            ? "Active assets are read from the private `branding` bucket with the service role."
            : "Reading uploaded files from .data/branding/ first, then assets/branding/source/. Set BRANDING_SOURCE=storage in production so uploads go to the private bucket. Assets are never served from /public."}
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        {status.assets.map((asset) => {
          const copy = ASSET_COPY[asset.kind];
          const Icon = copy.icon;
          const healthy = asset.present && asset.validation?.ok;
          return (
            <Card key={asset.kind}>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="space-y-1">
                    <CardTitle className="text-base">{copy.title}</CardTitle>
                    <CardDescription>{copy.description}</CardDescription>
                  </div>
                </div>
                {healthy ? (
                  <Badge className="gap-1 bg-success-soft text-success hover:bg-success-soft">
                    <CheckCircle2 className="size-3" /> Ready
                  </Badge>
                ) : (
                  <Badge className="gap-1 bg-danger-soft text-danger hover:bg-danger-soft">
                    <XCircle className="size-3" /> {asset.present ? "Invalid" : "Missing"}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {asset.present ? (
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Fingerprint</dt>
                    <dd className="font-mono text-xs">{asset.sha256}</dd>
                    {Object.entries(asset.validation?.info ?? {}).map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="capitalize text-muted-foreground">{key}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-muted-foreground">No file found.</p>
                )}
                {canEdit && (
                  <div className="pt-2">
                    <UploadAssetForm kind={asset.kind} accept={asset.kind === "letterhead" ? "application/pdf" : "image/png"} />
                  </div>
                )}
                {asset.validation?.errors.map((message) => (
                  <p key={message} className="text-destructive">
                    {message}
                  </p>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {settings && (
        <BrandingSettingsForm
          canEdit={canEdit}
          defaultValues={{
            require_approval: settings.require_approval,
            stamp_enabled: settings.stamp_enabled,
            signatory_name: settings.signatory_name ?? "",
            signatory_position: settings.signatory_position ?? "",
            stamp_x: settings.stamp_x === null ? "" : String(settings.stamp_x),
            stamp_y: settings.stamp_y === null ? "" : String(settings.stamp_y),
            stamp_width: settings.stamp_width === null ? "" : String(settings.stamp_width),
          }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand palette</CardTitle>
          <CardDescription>Sampled from the official letterhead artwork.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {[
            { name: "Purple", hex: BRAND.purple.hex },
            { name: "Lilac", hex: BRAND.lilac.hex },
            { name: "Body text", hex: BRAND.text.hex },
            { name: "Muted", hex: BRAND.muted.hex },
          ].map((swatch) => (
            <div key={swatch.name} className="flex items-center gap-3">
              <span className="size-10 rounded-md border" style={{ backgroundColor: swatch.hex }} aria-hidden />
              <div className="text-sm">
                <p className="font-medium">{swatch.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{swatch.hex}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

    </>
  );
}
