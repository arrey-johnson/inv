import { randomUUID } from "node:crypto";
import {
  DEFAULT_PAGE_SIZE,
  RepositoryError,
  type CustomerRepository,
  type ItemRepository,
  type RepositoryContext,
} from "@/lib/data/types";
import type { Customer, Item } from "@/types/database";
import { matchesQuery, paginate } from "./rows";
import type { DemoStore } from "./store";

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

function statusMatches(status: "active" | "inactive" | "all" | undefined, isActive: boolean): boolean {
  if (!status || status === "active") return isActive;
  return status === "all" ? true : !isActive;
}

export function createDemoCustomerRepository(store: DemoStore, ctx: RepositoryContext): CustomerRepository {
  const find = (rows: readonly Customer[], id: string) => rows.find((c) => c.id === id && !c.deleted_at);

  return {
    list: (filter) =>
      store.read((state) => {
        const rows = state.customers
          .filter((c) => !c.deleted_at)
          .filter((c) => (filter.type ? c.customer_type === filter.type : true))
          .filter((c) => statusMatches(filter.status === undefined ? "all" : filter.status, c.is_active))
          .filter((c) => matchesQuery(filter.q, [c.name, c.email, c.phone, c.niu, c.rccm, c.code, c.contact_name]))
          .sort(byName);
        return paginate(rows, filter.page, filter.pageSize ?? DEFAULT_PAGE_SIZE);
      }),

    listActive: (limit = 500) =>
      store.read((state) => state.customers.filter((c) => !c.deleted_at && c.is_active).sort(byName).slice(0, limit)),

    get: (id) => store.read((state) => find(state.customers, id) ?? null),

    create: (values) =>
      store.write((state) => {
        const duplicate = values.code && state.customers.some((c) => !c.deleted_at && c.code?.toLowerCase() === values.code?.toLowerCase());
        if (duplicate) throw new RepositoryError(`Customer code "${values.code}" is already used`, "conflict");
        const ts = new Date().toISOString();
        const row: Customer = {
          ...values,
          id: randomUUID(),
          organization_id: ctx.organizationId,
          created_by: ctx.userId,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        };
        state.customers.push(row);
        return row;
      }),

    update: (id, values) =>
      store.write((state) => {
        const row = find(state.customers, id);
        if (!row) throw new RepositoryError("Customer not found", "not_found");
        const duplicate =
          values.code && state.customers.some((c) => c.id !== id && !c.deleted_at && c.code?.toLowerCase() === values.code?.toLowerCase());
        if (duplicate) throw new RepositoryError(`Customer code "${values.code}" is already used`, "conflict");
        Object.assign(row, values, { updated_at: new Date().toISOString() });
        return row;
      }),

    setActive: (id, active) =>
      store.write((state) => {
        const row = find(state.customers, id);
        if (!row) throw new RepositoryError("Customer not found", "not_found");
        row.is_active = active;
        row.updated_at = new Date().toISOString();
        return row;
      }),
  };
}

export function createDemoItemRepository(store: DemoStore, ctx: RepositoryContext): ItemRepository {
  const find = (rows: readonly Item[], id: string) => rows.find((i) => i.id === id && !i.deleted_at);
  const skuTaken = (rows: readonly Item[], sku: string | null, exceptId?: string) =>
    Boolean(sku) && rows.some((i) => i.id !== exceptId && !i.deleted_at && i.sku?.toLowerCase() === sku?.toLowerCase());

  return {
    list: (filter) =>
      store.read((state) => {
        const rows = state.items
          .filter((i) => !i.deleted_at)
          .filter((i) => (filter.type ? i.item_type === filter.type : true))
          .filter((i) => statusMatches(filter.status === undefined ? "all" : filter.status, i.is_active))
          .filter((i) => matchesQuery(filter.q, [i.name, i.sku, i.description]))
          .sort(byName);
        return paginate(rows, filter.page, filter.pageSize ?? DEFAULT_PAGE_SIZE);
      }),

    listActive: (limit = 500) =>
      store.read((state) => state.items.filter((i) => !i.deleted_at && i.is_active).sort(byName).slice(0, limit)),

    get: (id) => store.read((state) => find(state.items, id) ?? null),

    create: (values) =>
      store.write((state) => {
        if (skuTaken(state.items, values.sku)) throw new RepositoryError(`Code "${values.sku}" is already used`, "conflict");
        const ts = new Date().toISOString();
        const row: Item = {
          ...values,
          id: randomUUID(),
          organization_id: ctx.organizationId,
          created_by: ctx.userId,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        };
        state.items.push(row);
        return row;
      }),

    update: (id, values) =>
      store.write((state) => {
        const row = find(state.items, id);
        if (!row) throw new RepositoryError("Item not found", "not_found");
        if (skuTaken(state.items, values.sku, id)) throw new RepositoryError(`Code "${values.sku}" is already used`, "conflict");
        Object.assign(row, values, { updated_at: new Date().toISOString() });
        return row;
      }),

    createManyIfMissing: (values) =>
      store.write((state) => {
        let created = 0;
        for (const value of values) {
          if (skuTaken(state.items, value.sku)) continue;
          const ts = new Date().toISOString();
          state.items.push({
            ...value,
            id: randomUUID(),
            organization_id: ctx.organizationId,
            created_by: ctx.userId,
            created_at: ts,
            updated_at: ts,
            deleted_at: null,
          });
          created += 1;
        }
        return created;
      }),
  };
}
