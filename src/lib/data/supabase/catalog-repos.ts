import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PAGE_SIZE,
  type CustomerRepository,
  type ItemRepository,
  type RepositoryContext,
} from "@/lib/data/types";
import type { Customer, Database, Item } from "@/types/database";
import { rangeFor, searchTerm, toRepositoryError, unwrap } from "./helpers";

type Client = SupabaseClient<Database>;

export function createSupabaseCustomerRepository(db: Client, ctx: RepositoryContext): CustomerRepository {
  return {
    async list(filter) {
      const { from, to, page, pageSize } = rangeFor(filter.page, filter.pageSize ?? DEFAULT_PAGE_SIZE);
      let query = db
        .from("customers")
        .select("*", { count: "exact" })
        .eq("organization_id", ctx.organizationId)
        .is("deleted_at", null);
      if (filter.type) query = query.eq("customer_type", filter.type);
      if (filter.status === "active") query = query.eq("is_active", true);
      if (filter.status === "inactive") query = query.eq("is_active", false);
      const q = searchTerm(filter.q);
      if (q) {
        query = query.or(
          ["name", "email", "phone", "niu", "rccm", "code", "contact_name"].map((c) => `${c}.ilike.%${q}%`).join(","),
        );
      }
      const { data, error, count } = await query.order("name").range(from, to);
      if (error) throw toRepositoryError(error, "Could not load customers");
      return { rows: data ?? [], total: count ?? 0, page, pageSize };
    },

    async listActive(limit = 500) {
      const { data, error } = await db
        .from("customers")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("name")
        .limit(limit);
      if (error) throw toRepositoryError(error, "Could not load customers");
      return data ?? [];
    },

    async get(id) {
      const { data, error } = await db
        .from("customers")
        .select("*")
        .eq("id", id)
        .eq("organization_id", ctx.organizationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw toRepositoryError(error, "Could not load the customer");
      return data;
    },

    async create(values) {
      return unwrap(
        await db
          .from("customers")
          .insert({ ...values, organization_id: ctx.organizationId, created_by: ctx.userId })
          .select("*")
          .single(),
        "Could not create the customer",
      ) satisfies Customer;
    },

    async update(id, values) {
      return unwrap(
        await db.from("customers").update(values).eq("id", id).eq("organization_id", ctx.organizationId).select("*").single(),
        "Could not update the customer",
      ) satisfies Customer;
    },

    async setActive(id, active) {
      return unwrap(
        await db.from("customers").update({ is_active: active }).eq("id", id).eq("organization_id", ctx.organizationId).select("*").single(),
        "Could not update the customer",
      ) satisfies Customer;
    },
  };
}

export function createSupabaseItemRepository(db: Client, ctx: RepositoryContext): ItemRepository {
  return {
    async list(filter) {
      const { from, to, page, pageSize } = rangeFor(filter.page, filter.pageSize ?? DEFAULT_PAGE_SIZE);
      let query = db
        .from("items")
        .select("*", { count: "exact" })
        .eq("organization_id", ctx.organizationId)
        .is("deleted_at", null);
      if (filter.type) query = query.eq("item_type", filter.type);
      if (filter.status === "active") query = query.eq("is_active", true);
      if (filter.status === "inactive") query = query.eq("is_active", false);
      const q = searchTerm(filter.q);
      if (q) query = query.or(["name", "sku", "description"].map((c) => `${c}.ilike.%${q}%`).join(","));
      const { data, error, count } = await query.order("name").range(from, to);
      if (error) throw toRepositoryError(error, "Could not load items");
      return { rows: data ?? [], total: count ?? 0, page, pageSize };
    },

    async listActive(limit = 500) {
      const { data, error } = await db
        .from("items")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("name")
        .limit(limit);
      if (error) throw toRepositoryError(error, "Could not load items");
      return data ?? [];
    },

    async get(id) {
      const { data, error } = await db
        .from("items")
        .select("*")
        .eq("id", id)
        .eq("organization_id", ctx.organizationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw toRepositoryError(error, "Could not load the item");
      return data;
    },

    async create(values) {
      return unwrap(
        await db
          .from("items")
          .insert({ ...values, organization_id: ctx.organizationId, created_by: ctx.userId })
          .select("*")
          .single(),
        "Could not create the item",
      ) satisfies Item;
    },

    async update(id, values) {
      return unwrap(
        await db.from("items").update(values).eq("id", id).eq("organization_id", ctx.organizationId).select("*").single(),
        "Could not update the item",
      ) satisfies Item;
    },

    async createManyIfMissing(values) {
      const { data: existing, error } = await db
        .from("items")
        .select("sku")
        .eq("organization_id", ctx.organizationId)
        .is("deleted_at", null)
        .not("sku", "is", null);
      if (error) throw toRepositoryError(error, "Could not read existing items");
      const taken = new Set((existing ?? []).map((row) => row.sku?.toLowerCase()));
      const fresh = values.filter((v) => !v.sku || !taken.has(v.sku.toLowerCase()));
      if (fresh.length === 0) return 0;
      const { error: insertError } = await db
        .from("items")
        .insert(fresh.map((v) => ({ ...v, organization_id: ctx.organizationId, created_by: ctx.userId })));
      if (insertError) throw toRepositoryError(insertError, "Could not create the catalog items");
      return fresh.length;
    },
  };
}
