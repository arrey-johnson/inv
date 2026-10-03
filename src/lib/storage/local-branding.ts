import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local default branding files. They live OUTSIDE `public/` so they can never be fetched by URL:
 *   assets/branding/source/letterhead-promptstack.pdf
 *   assets/branding/source/company-stamp.png
 * Production uses private Supabase Storage (bucket `branding`) - see ./branding.ts.
 */
export const LOCAL_BRANDING_DIR = path.join("assets", "branding", "source");
export const LOCAL_LETTERHEAD_FILE = "letterhead-promptstack.pdf";
export const LOCAL_STAMP_FILE = "company-stamp.png";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readIfExists(filePath: string): Promise<Uint8Array | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
    return new Uint8Array(await readFile(filePath));
  } catch {
    return null;
  }
}

/**
 * Local-mode uploads (Settings > Branding when Supabase is not configured) are written here, never
 * over the tracked defaults. `.data/` is gitignored and outside `public/`.
 */
export const LOCAL_UPLOAD_DIR = path.join(".data", "branding");

export async function readLocalLetterhead(root: string = process.cwd()): Promise<Uint8Array | null> {
  return (
    (await readIfExists(path.join(root, LOCAL_UPLOAD_DIR, LOCAL_LETTERHEAD_FILE))) ??
    (await readIfExists(path.join(root, LOCAL_BRANDING_DIR, LOCAL_LETTERHEAD_FILE)))
  );
}

export async function readLocalStamp(root: string = process.cwd()): Promise<Uint8Array | null> {
  return (
    (await readIfExists(path.join(root, LOCAL_UPLOAD_DIR, LOCAL_STAMP_FILE))) ??
    (await readIfExists(path.join(root, LOCAL_BRANDING_DIR, LOCAL_STAMP_FILE)))
  );
}

export async function writeLocalUpload(
  kind: "letterhead" | "stamp",
  bytes: Uint8Array,
  root: string = process.cwd(),
): Promise<void> {
  const dir = path.join(root, LOCAL_UPLOAD_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, kind === "letterhead" ? LOCAL_LETTERHEAD_FILE : LOCAL_STAMP_FILE), bytes);
}
