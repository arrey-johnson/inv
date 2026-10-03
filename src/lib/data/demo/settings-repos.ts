import { randomUUID } from "node:crypto";
import {
  RepositoryError,
  type OrganizationRepository,
  type PaymentDestinationRepository,
  type RepositoryContext,
  type SequenceRepository,
  type TaxRepository,
  type TeamRepository,
} from "@/lib/data/types";
import type { DemoStore } from "./store";

export function createDemoOrganizationRepository(store: DemoStore): OrganizationRepository {
  return {
    get: () => store.read((s) => s.organization),
    update: (values) =>
      store.write((s) => {
        Object.assign(s.organization, values, { updated_at: new Date().toISOString() });
        return s.organization;
      }),
    getSettings: () => store.read((s) => s.settings),
    updateSettings: (patch) =>
      store.write((s) => {
        const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        Object.assign(s.settings, clean, { updated_at: new Date().toISOString() });
        return s.settings;
      }),
  };
}

export function createDemoTaxRepository(store: DemoStore, ctx: RepositoryContext): TaxRepository {
  return {
    listRates: () => store.read((s) => [...s.tax_rates].sort((a, b) => b.rate - a.rate || a.code.localeCompare(b.code))),

    createRate: (values) =>
      store.write((s) => {
        if (s.tax_rates.some((r) => r.code.toLowerCase() === values.code.toLowerCase())) {
          throw new RepositoryError(`Tax code "${values.code}" already exists`, "conflict");
        }
        const ts = new Date().toISOString();
        const row = { ...values, id: randomUUID(), organization_id: ctx.organizationId, is_default: false, created_at: ts, updated_at: ts };
        s.tax_rates.push(row);
        return row;
      }),

    updateRate: (id, values) =>
      store.write((s) => {
        const row = s.tax_rates.find((r) => r.id === id);
        if (!row) throw new RepositoryError("Tax rate not found", "not_found");
        if (values.is_active === false && row.is_default) {
          throw new RepositoryError("The default rate cannot be deactivated. Choose another default first.", "conflict");
        }
        Object.assign(row, values, { updated_at: new Date().toISOString() });
        return row;
      }),

    setDefaultRate: (id) =>
      store.write((s) => {
        const target = s.tax_rates.find((r) => r.id === id);
        if (!target) throw new RepositoryError("Tax rate not found", "not_found");
        if (!target.is_active) throw new RepositoryError("An inactive rate cannot be the default", "conflict");
        for (const rate of s.tax_rates) rate.is_default = rate.id === id;
        s.settings.default_tax_rate_id = id;
      }),

    listWithholdings: () => store.read((s) => [...s.withholding_types].sort((a, b) => a.code.localeCompare(b.code))),

    createWithholding: (values) =>
      store.write((s) => {
        if (s.withholding_types.some((w) => w.code.toLowerCase() === values.code.toLowerCase())) {
          throw new RepositoryError(`Withholding code "${values.code}" already exists`, "conflict");
        }
        const ts = new Date().toISOString();
        const row = { ...values, id: randomUUID(), organization_id: ctx.organizationId, created_at: ts, updated_at: ts };
        s.withholding_types.push(row);
        return row;
      }),

    updateWithholding: (id, values) =>
      store.write((s) => {
        const row = s.withholding_types.find((w) => w.id === id);
        if (!row) throw new RepositoryError("Withholding type not found", "not_found");
        if (values.code && s.withholding_types.some((w) => w.id !== id && w.code.toLowerCase() === values.code!.toLowerCase())) {
          throw new RepositoryError(`Withholding code "${values.code}" already exists`, "conflict");
        }
        Object.assign(row, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)), {
          updated_at: new Date().toISOString(),
        });
        return row;
      }),
  };
}

export function createDemoPaymentDestinationRepository(
  store: DemoStore,
  ctx: RepositoryContext,
): PaymentDestinationRepository {
  const ensureSingleDefault = (state: { payment_destinations: Array<{ id: string; kind: string; is_default: boolean }> }, id: string, isDefault: boolean) => {
    if (!isDefault) return;
    for (const d of state.payment_destinations) d.is_default = d.id === id;
  };

  return {
    list: () =>
      store.read((s) =>
        [...s.payment_destinations].sort(
          (a, b) => Number(b.is_default) - Number(a.is_default) || a.sort_order - b.sort_order || a.label.localeCompare(b.label),
        ),
      ),

    create: (values) =>
      store.write((s) => {
        const ts = new Date().toISOString();
        const row = {
          ...values,
          id: randomUUID(),
          organization_id: ctx.organizationId,
          sort_order: s.payment_destinations.length,
          created_at: ts,
          updated_at: ts,
        };
        s.payment_destinations.push(row);
        ensureSingleDefault(s, row.id, row.is_default);
        return row;
      }),

    update: (id, values) =>
      store.write((s) => {
        const row = s.payment_destinations.find((d) => d.id === id);
        if (!row) throw new RepositoryError("Payment destination not found", "not_found");
        Object.assign(row, values, { updated_at: new Date().toISOString() });
        ensureSingleDefault(s, id, row.is_default);
        return row;
      }),

    remove: (id) =>
      store.write((s) => {
        const before = s.payment_destinations.length;
        s.payment_destinations = s.payment_destinations.filter((d) => d.id !== id);
        if (s.payment_destinations.length === before) throw new RepositoryError("Payment destination not found", "not_found");
      }),
  };
}

export function createDemoSequenceRepository(store: DemoStore): SequenceRepository {
  return {
    list: () =>
      store.read((s) => ({
        sequences: [...s.document_sequences].sort((a, b) => a.document_type.localeCompare(b.document_type)),
        counters: [...s.document_sequence_counters],
      })),
    update: (documentType, values) =>
      store.write((s) => {
        const row = s.document_sequences.find((q) => q.document_type === documentType);
        if (!row) throw new RepositoryError("Sequence not found", "not_found");
        Object.assign(row, values, { updated_at: new Date().toISOString() });
        return row;
      }),
  };
}

export function createDemoTeamRepository(store: DemoStore): TeamRepository {
  return {
    listMembers: () => store.read((s) => [...s.members]),
    setRole: (userId, role) =>
      store.write((s) => {
        const member = s.members.find((m) => m.userId === userId);
        if (!member) throw new RepositoryError("Member not found", "not_found");
        if (member.role === "admin" && role !== "admin" && s.members.filter((m) => m.role === "admin").length <= 1) {
          throw new RepositoryError("An organization must keep at least one admin", "conflict");
        }
        member.role = role;
      }),
  };
}
