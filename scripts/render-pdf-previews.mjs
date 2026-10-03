import fs from "fs";
import path from "path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const outDir = ".tmp/preview";
fs.mkdirSync(outDir, { recursive: true });

async function renderPdf(pdfPath, prefix, maxPages = 2) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    // White background so transparent areas don't look black
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const out = path.join(outDir, `${prefix}-p${i}.png`);
    fs.writeFileSync(out, canvas.toBuffer("image/png"));
    console.log("wrote", out, `${canvas.width}x${canvas.height}`);
  }
}

const jobs = [
  [".tmp/sample-invoice.pdf", "invoice", 1],
  [".tmp/sample-draft.pdf", "draft", 1],
  [".tmp/sample-invoice-multipage.pdf", "multipage", 2],
  ["assets/branding/source/letterhead-promptstack.pdf", "letterhead-only", 1],
];

for (const [file, prefix, pages] of jobs) {
  if (!fs.existsSync(file)) {
    console.warn("skip missing", file);
    continue;
  }
  await renderPdf(file, prefix, pages);
}

console.log("done");
