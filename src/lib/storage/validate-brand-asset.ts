import { PDFDocument } from "pdf-lib";

export interface AssetValidation {
  ok: boolean;
  errors: string[];
  /** Extra facts shown in the Branding settings page. */
  info: Record<string, string | number>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export const BRAND_ASSET_LIMITS = {
  letterheadMaxBytes: 10 * 1024 * 1024,
  stampMaxBytes: 5 * 1024 * 1024,
  stampMinPixels: 200,
  stampMaxPixels: 4000,
  /** A4 in points with tolerance. */
  a4: { width: 595.28, height: 841.89, tolerance: 4 },
} as const;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}

/** Letterhead must be a real single-page A4 PDF (it is used as the background of every page). */
export async function validateLetterheadPdf(bytes: Uint8Array): Promise<AssetValidation> {
  const errors: string[] = [];
  const info: AssetValidation["info"] = { bytes: bytes.length };

  if (bytes.length > BRAND_ASSET_LIMITS.letterheadMaxBytes) errors.push("Letterhead is larger than 10 MB.");
  if (!startsWith(bytes, PDF_SIGNATURE)) {
    errors.push("File is not a PDF.");
    return { ok: false, errors, info };
  }

  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pages = doc.getPageCount();
    info.pages = pages;
    if (pages !== 1) errors.push(`Letterhead must have exactly 1 page (found ${pages}).`);
    const { width, height } = doc.getPage(0).getSize();
    info.width = Number(width.toFixed(2));
    info.height = Number(height.toFixed(2));
    const { a4 } = BRAND_ASSET_LIMITS;
    if (Math.abs(width - a4.width) > a4.tolerance || Math.abs(height - a4.height) > a4.tolerance) {
      errors.push(`Letterhead must be A4 portrait (595 x 842 pt); found ${info.width} x ${info.height} pt.`);
    }
  } catch {
    errors.push("PDF could not be read (corrupt or encrypted).");
  }
  return { ok: errors.length === 0, errors, info };
}

/** Read width/height from the PNG IHDR chunk without decoding the image. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !startsWith(bytes, PNG_SIGNATURE)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Stamp must be a PNG (transparency support) with sensible dimensions. */
export function validateStampPng(bytes: Uint8Array): AssetValidation {
  const errors: string[] = [];
  const info: AssetValidation["info"] = { bytes: bytes.length };

  if (bytes.length > BRAND_ASSET_LIMITS.stampMaxBytes) errors.push("Stamp is larger than 5 MB.");
  const size = readPngSize(bytes);
  if (!size) {
    errors.push("File is not a PNG.");
    return { ok: false, errors, info };
  }
  info.width = size.width;
  info.height = size.height;
  const { stampMinPixels: min, stampMaxPixels: max } = BRAND_ASSET_LIMITS;
  if (size.width < min || size.height < min) errors.push(`Stamp is too small (minimum ${min}px per side).`);
  if (size.width > max || size.height > max) errors.push(`Stamp is too large (maximum ${max}px per side).`);
  return { ok: errors.length === 0, errors, info };
}
