import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDemoRepository, DEMO_CONTEXT } from "@/lib/data/demo/demo-repository";
import { FileDemoStore } from "@/lib/data/demo/store";
import type { Repository } from "@/lib/data/types";
import { saveDraft } from "../draft-service";
import { issueDocument, type IssueDependencies } from "../issue-service";
import { makeRepository, parseInput, seedCustomer, standardVat } from "./fixtures";

const admin = { role: "admin" } as const;
const year = new Date().getFullYear();
// Numbering is what is under test here, so skip the (slow) PDF rendering.
const deps: IssueDependencies = {
  renderPdf: async () => ({ bytes: new TextEncoder().encode("%PDF-test"), filename: "test.pdf" }),
};

async function makeDrafts(repo: Repository, count: number, documentType: "invoice" | "proforma") {
  const customer = await seedCustomer(repo);
  const vat = await standardVat(repo);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const draft = await saveDraft(repo, admin, parseInput({ customerId: customer.id, documentType }, vat.id));
    ids.push(draft.id);
  }
  return ids;
}

describe("demo numbering", () => {
  it("drafts never get a number", async () => {
    const { repo } = makeRepository();
    const ids = await makeDrafts(repo, 3, "invoice");
    for (const id of ids) expect((await repo.documents.get(id))?.document.number).toBeNull();
  });

  it("25 parallel issues produce 25 unique, gapless, ordered numbers", async () => {
    const { repo } = makeRepository();
    const ids = await makeDrafts(repo, 25, "invoice");

    const results = await Promise.all(ids.map((id) => issueDocument(repo, admin, id, deps)));
    const numbers = results.map((r) => r.document.number!);

    expect(new Set(numbers).size).toBe(25);
    const expected = Array.from({ length: 25 }, (_, i) => `PS-INV-${year}-${String(i + 1).padStart(4, "0")}`);
    expect([...numbers].sort()).toEqual(expected);
  });

  it("invoices and proformas count independently", async () => {
    const { repo } = makeRepository();
    const [invoiceId] = await makeDrafts(repo, 1, "invoice");
    const [proformaId] = await makeDrafts(repo, 1, "proforma");
    const [invoice, proforma] = await Promise.all([
      issueDocument(repo, admin, invoiceId, deps),
      issueDocument(repo, admin, proformaId, deps),
    ]);
    expect(invoice.document.number).toBe(`PS-INV-${year}-0001`);
    expect(proforma.document.number).toBe(`PS-PF-${year}-0001`);
  });

  it("a failed issue does not burn a number", async () => {
    const { repo } = makeRepository();
    const [first, second] = await makeDrafts(repo, 2, "invoice");
    // Break the first draft so validation fails after it has been loaded.
    await repo.documents.deleteDraft(first);
    await expect(issueDocument(repo, admin, first, deps)).rejects.toThrow();
    const ok = await issueDocument(repo, admin, second, deps);
    expect(ok.document.number).toBe(`PS-INV-${year}-0001`);
  });

  it("issuing the same draft twice in parallel yields one number and one failure", async () => {
    const { repo } = makeRepository();
    const [id] = await makeDrafts(repo, 1, "invoice");
    const settled = await Promise.allSettled([issueDocument(repo, admin, id, deps), issueDocument(repo, admin, id, deps)]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((s) => s.status === "rejected")).toHaveLength(1);
    const next = (await makeDrafts(repo, 1, "invoice"))[0];
    expect((await issueDocument(repo, admin, next, deps)).document.number).toBe(`PS-INV-${year}-0002`);
  });
});

describe("file-backed demo store", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "promptstack-demo-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists numbers across store instances and stays gapless under concurrency", async () => {
    const repoA = createDemoRepository(new FileDemoStore(dir), DEMO_CONTEXT);
    const ids = await makeDrafts(repoA, 8, "invoice");
    await Promise.all(ids.map((id) => issueDocument(repoA, admin, id, deps)));

    // A brand new store reading the same directory (as after a dev-server restart).
    const repoB = createDemoRepository(new FileDemoStore(dir), DEMO_CONTEXT);
    const more = await makeDrafts(repoB, 1, "invoice");
    const issued = await issueDocument(repoB, admin, more[0], deps);
    expect(issued.document.number).toBe(`PS-INV-${year}-0009`);

    const raw = JSON.parse(await readFile(path.join(dir, "demo-db.json"), "utf8"));
    expect(raw).toBeTruthy();
  });
});
