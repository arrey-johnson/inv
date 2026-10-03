import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readLocalLetterhead, readLocalStamp, sha256Hex } from "../local-branding";
import { readPngSize, validateLetterheadPdf, validateStampPng } from "../validate-brand-asset";

const hasAssets =
  existsSync("assets/branding/source/letterhead-promptstack.pdf") &&
  existsSync("assets/branding/source/company-stamp.png");

describe("brand asset validation (synthetic)", () => {
  it("rejects non-PDF letterheads", async () => {
    const result = await validateLetterheadPdf(new TextEncoder().encode("not a pdf"));
    expect(result.ok).toBe(false);
  });

  it("rejects multi-page and non-A4 letterheads, accepts single A4 page", async () => {
    const multi = await PDFDocument.create();
    multi.addPage([595.28, 841.89]);
    multi.addPage([595.28, 841.89]);
    expect((await validateLetterheadPdf(await multi.save())).ok).toBe(false);

    const letter = await PDFDocument.create();
    letter.addPage([612, 792]);
    expect((await validateLetterheadPdf(await letter.save())).ok).toBe(false);

    const a4 = await PDFDocument.create();
    a4.addPage([595.28, 841.89]);
    expect((await validateLetterheadPdf(await a4.save())).ok).toBe(true);
  });

  it("rejects non-PNG stamps and reads PNG sizes", () => {
    expect(validateStampPng(new Uint8Array([1, 2, 3])).ok).toBe(false);
    expect(readPngSize(new Uint8Array(10))).toBeNull();
  });
});

describe.skipIf(!hasAssets)("official Promptstack assets", () => {
  it("letterhead is a valid single A4 page", async () => {
    const bytes = await readLocalLetterhead();
    expect(bytes).not.toBeNull();
    const result = await validateLetterheadPdf(bytes!);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("stamp is a valid PNG", async () => {
    const bytes = await readLocalStamp();
    expect(bytes).not.toBeNull();
    const result = validateStampPng(bytes!);
    expect(result.errors).toEqual([]);
    expect(readPngSize(bytes!)).toEqual({ width: 552, height: 452 });
    expect(sha256Hex(bytes!)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the stamp is NOT inside public/", () => {
    expect(existsSync("public/company-stamp.png")).toBe(false);
    expect(existsSync("public/assets")).toBe(false);
  });
});
