/**
 * PDF layout constants for Promptstack documents (A4 portrait).
 *
 * Coordinate system: PDF points (1pt = 1/72in), origin at the BOTTOM-LEFT of the page
 * (pdf-lib convention). All numbers below were measured from the official letterhead
 * (`assets/branding/source/letterhead-promptstack.pdf`, 595.32 x 841.92 pt):
 *
 *   - Logo (header)          x 72 -> 234,  y 771 -> 807
 *   - Header diamonds        top-right, down to y ~ 718 (x 375 -> 663)
 *   - Footer gradient band   y -13 -> 105 (contact text sits at y 36 -> 81)
 *   - Bottom-right diamond   reaches y ~ 181 but only for x > 497, narrowing quickly
 *
 * Content must therefore stay inside the "safe area" below. Changing the letterhead
 * artwork? Re-measure and update these constants - nothing else should hard-code positions.
 */

export const PAGE = {
  width: 595.32,
  height: 841.92,
} as const;

/** Brand colours sampled from the letterhead artwork (RGB 0-1 for pdf-lib, plus hex for UI). */
export const BRAND = {
  /** Strong purple used for the letterhead diamonds: rgb(0.553, 0.0824, 0.718) = #8D15B7 */
  purple: { r: 0.553, g: 0.0824, b: 0.718, hex: "#8D15B7" },
  /** Light lilac accent: rgb(0.796, 0.663, 0.898) = #CBA9E5 */
  lilac: { r: 0.796, g: 0.663, b: 0.898, hex: "#CBA9E5" },
  /** Body text - dark gray / near black. */
  text: { r: 0.11, g: 0.11, b: 0.12, hex: "#1C1C1F" },
  /** Secondary text. */
  muted: { r: 0.4, g: 0.4, b: 0.43, hex: "#66666E" },
  /** Hairlines and table rules. */
  rule: { r: 0.85, g: 0.85, b: 0.88, hex: "#D9D9E0" },
  /** Zebra / table header tint (very light lilac). */
  tint: { r: 0.965, g: 0.945, b: 0.98, hex: "#F6F1FA" },
  white: { r: 1, g: 1, b: 1, hex: "#FFFFFF" },
} as const;

export const DOCUMENT_LAYOUT = {
  page: PAGE,

  margins: {
    left: 72,
    right: 72,
  },

  /** Safe vertical limits for flowing content (PDF y coordinates). */
  safeArea: {
    /** First baseline region below the logo / diamonds on page 1. */
    firstPageTop: 735,
    /** Top of content on continuation pages (header artwork is the same, so same limit). */
    continuationTop: 735,
    /** Lowest y that table rows may reach (clear of the footer band + diamond). */
    bottom: 132,
  },

  /** Width of the printable column: page width - margins. */
  contentWidth: PAGE.width - 72 - 72,

  fonts: {
    title: 20,
    heading: 11,
    body: 9,
    small: 8,
    tiny: 7,
    lineHeightRatio: 1.35,
  },

  colors: BRAND,

  /**
   * Items table column plan. Widths in pt, sum = contentWidth (451.32). Description grows to fill.
   * VAT is intentionally NOT a line column — it appears only in the document totals block.
   */
  table: {
    headerHeight: 20,
    rowPaddingY: 5,
    rowPaddingX: 5,
    columns: {
      index: 22,
      quantity: 42,
      unitPrice: 72,
      discount: 48,
      total: 78,
      // description = contentWidth - sum(others)
    },
  },

  /** Right-aligned totals block. */
  totals: {
    width: 210,
    rowHeight: 15,
  },
} as const;

/**
 * Company stamp placement. Rendered on every page when the document status allows it
 * (see `shouldApplyStamp` in the renderer), in the bottom-right corner of the printable area,
 * above the footer band. Content flow clears this zone on all pages.
 *
 * Stamp PNG is 552x452 (aspect ~1.22). Width drives the size; height follows the aspect ratio.
 */
export const STAMP_LAYOUT = {
  /** Rendered width in pt. */
  width: 128,
  /** Right edge of the stamp aligns with the right margin. */
  rightInset: DOCUMENT_LAYOUT.margins.right,
  /** Distance of the stamp's bottom edge from the bottom of the page. */
  bottom: 140,
  /** 0-1. Slightly translucent so the paper texture / text beneath remains legible. */
  opacity: 0.92,
  /** Degrees. A small tilt looks like a real hand-applied stamp; set 0 for none. */
  rotationDegrees: -4,
  /** Minimum breathing room between closing content and the stamp zone (pt). */
  clearance: 10,
} as const;

/** Admin-configured placement (Settings > Branding). `null`/`undefined` = use the default above. */
export interface StampLayoutOverride {
  /** Left edge, in PDF points from the left of the page. */
  x?: number | null;
  /** Bottom edge, in PDF points from the bottom of the page. */
  y?: number | null;
  width?: number | null;
}

/** Stamp rectangle derived from the layout constants (or admin overrides) and the image aspect ratio. */
export function getStampRect(imageWidth: number, imageHeight: number, override?: StampLayoutOverride | null) {
  const width = Math.min(PAGE.width, Math.max(1, override?.width ?? STAMP_LAYOUT.width));
  const height = width * (imageHeight / imageWidth);
  const defaultX = PAGE.width - STAMP_LAYOUT.rightInset - width;
  // Keep the whole stamp on the page whatever the saved values are.
  const x = Math.min(PAGE.width - width, Math.max(0, override?.x ?? defaultX));
  const y = Math.min(PAGE.height - height, Math.max(0, override?.y ?? STAMP_LAYOUT.bottom));
  return { x, y, width, height, top: y + height };
}