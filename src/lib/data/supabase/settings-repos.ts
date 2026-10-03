import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RepositoryError,
  type OrganizationRepository,
  type PaymentDestinationRepository,
  type RepositoryContext,
  type SequenceRepository,
  type TaxRepository,
  type TeamRepository,
} from "@/lib/data/types";
import type { Database } from "@/types/database";
import { stripUndefined, toRepositoryError, unwrap } from "./helpers";

type Client = SupabaseClient<Database>;

export function createSupabaseOrganizationRepository(db: Client, ctx: RepositoryContext): OrganizationRepository {
  return {
    async get() {
      const { data, error } = await db.from("organizations").select("*").eq("id", ctx.organizationId).maybeSingle();
      if (error) throw toRepositoryError(error, "Could not load the organization");
      return data;
    },
    async update(values) {
      return unwrap(
        await db.from("organizations").update(values).eq("id", ctx.organizationId).select("*").single(),
        "Could not save company details",
      );
    },
    async getSettings() {
      const { data, error } = await db
        .from("organization_settings")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      if (error) throw toRepositoryError(error, "Could not load settings");
      return data;
    },
    async updateSettings(patch) {
      return unwrap(
        await db
          .from("organization_settings")
          .update(stripUndefined(patch))
          .eq("organization_id", ctx.organizationId)
          .select("*")
          .single(),
        "Could not save settings",
      );
    },
  };
}

export function createSupabaseTaxRepository(db: Client, ctx: RepositoryContext): TaxRepository {
  return {
    async listRates() {
      const { data, error } = await db
        .from("tax_rates")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .order("rate", { ascending: false })
        .order("code");
      if (error) throw toRepositoryError(error, "Could not load tax rates");
      return data ?? [];
    },
    async createRate(values) {
      return unwrap(
        await db
          .from("tax_rates")
          .insert({ ...values, organization_id: ctx.organizationId, is_default: false })
          .select("*")
          .single(),
        "Could not create the tax rate",
      );
    },
    async updateRate(id, values) {
      if (values.is_active === false) {
        const { data: current } = await db.from("tax_rates").select("is_default").eq("id", id).maybeSingle();
        if (current?.is_default) {
          throw new RepositoryError("The default rate cannot be deactivated. Choose another default first.", "conflict");
        }
      }
      return unwrap(
        await db.from("tax_rates").update(values).eq("id", id).eq("organization_id", ctx.organizationId).select("*").single(),
        "Could not update the tax rate",
      );
    },
    async setDefaultRate(id) {
      const { data: target } = await db
        .from("tax_rates")
        .select("id, is_active")
        .eq("id", id)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      if (!target) throw new RepositoryError("Tax rate not found", "not_found");
      if (!target.is_active) throw new RepositoryError("An inactive rate cannot be the default", "conflict");

      // Only one default may exist (partial unique index): clear first, then set.
      const cleared = await db
        .from("tax_rates")
        .update({ is_default: false })
        .eq("organization_id", ctx.organizationId)
        .eq("is_default", true);
      if (cleared.error) throw toRepositoryError(cleared.error, "Could not change the default rate");
      const set = await db.from("tax_rates").update({ is_default: true }).eq("id", id);
      if (set.error) throw toRepositoryError(set.error, "Could not change the default rate");
      const settings = await db
        .from("organization_settings")
        .update({ default_tax_rate_id: id })
        .eq("organization_id", ctx.organizationId);
      if (settings.error) throw toRepositoryError(settings.error, "Could not change the default rate");
    },
    async listWithholdings() {
      const { data, error } = await db
        .from("withholding_types")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .order("code");
      if (error) throw toRepositoryError(error, "Could not load withholding types");
      return data ?? [];
    },
    async createWithholding(values) {
      return unwrap(
        await db
          .from("withholding_types")
          .insert({ ...values, organization_id: ctx.organizationId })
          .select("*")
          .single(),
        "Could not create the withholding type",
      );
    },
    async updateWithholding(id, values) {
      return unwrap(
        await db
          .from("withholding_types")
          .update(stripUndefined(values))
          .eq("id", id)
          .eq("organization_id", ctx.organizationId)
          .select("*")
          .single(),
        "Could not update the withholding type",
      );
    },
  };
}

export function createSupabasePaymentDestinationRepository(db: Client, ctx: RepositoryContext): PaymentDestinationRepository {
  async function clearOtherDefaults(keepId: string) {
    const { error } = await db
      .from("payment_destinations")
      .update({ is_default: false })
      .eq("organization_id", ctx.organizationId)
      .neq("id", keepId);
    if (error) throw toRepositoryError(error, "Could not update the default destination");
  }

  return {
    async list() {
      const { data, error } = await db
        .from("payment_destinations")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .order("is_default", { ascending: false })
        .order("sort_order")
        .order("label");
      if (error) throw toRepositoryError(error, "Could not load payment destinations");
      return data ?? [];
    },
    async create(values) {
      const row = unwrap(
        await db.from("payment_destinations").insert({ ...values, organization_id: ctx.organizationId }).select("*").single(),
        "Could not create the payment destination",
      );
      if (row.is_default) await clearOtherDefaults(row.id);
      return row;
    },
    async update(id, values) {
      const row = unwrap(
        await db
          .from("payment_destinations")
          .update(values)
          .eq("id", id)
          .eq("organization_id", ctx.organizationId)
          .select("*")
          .single(),
        "Could not update the payment destination",
      );
      if (row.is_default) await clearOtherDefaults(row.id);
      return row;
    },
    async remove(id) {
      const { error } = await db.from("payment_destinations").delete().eq("id", id).eq("organization_id", ctx.organizationId);
      if (error) throw toRepositoryError(error, "Could not delete the payment destination");
    },
  };
}

export function createSupabaseSequenceRepository(db: Client, ctx: RepositoryContext): SequenceRepository {
  return {
    async list() {
      const [sequences, counters] = await Promise.all([
        db.from("document_sequences").select("*").eq("organization_id", ctx.organizationId).order("document_type"),
        db.from("document_sequence_counters").select("*").eq("organization_id", ctx.organizationId),
      ]);
      if (sequences.error) throw toRepositoryError(sequences.error, "Could not load numbering");
      // Counters are readable by finance roles only; other roles simply see "none yet".
      return { sequences: sequences.data ?? [], counters: counters.data ?? [] };
    },
    async update(documentType, values) {
      return unwrap(
        await db
          .from("document_sequences")
          .update(values)
          .eq("organization_id", ctx.organizationId)
          .eq("document_type", documentType)
          .select("*")
          .single(),
        "Could not update numbering",
      );
    },
  };
}

export function createSupabaseTeamRepository(db: Client, ctx: RepositoryContext): TeamRepository {
  return {
    async listMembers() {
      const { data: roles, error } = await db
        .from("user_roles")
        .select("user_id, role, created_at")
        .eq("organization_id", ctx.organizationId)
        .order("created_at");
      if (error) throw toRepositoryError(error, "Could not load members");
      const ids = (roles ?? []).map((r) => r.user_id);
      const { data: profiles } = ids.length
        ? await db.from("profiles").select("id, full_name, email, is_active").in("id", ids)
        : { data: [] };
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      return (roles ?? []).map((r) => ({
        userId: r.user_id,
        email: byId.get(r.user_id)?.email ?? null,
        fullName: byId.get(r.user_id)?.full_name ?? null,
        role: r.role,
        isActive: byId.get(r.user_id)?.is_active !== false,
        since: r.created_at,
      }));
    },
    async setRole(userId, role) {
      const { error } = await db
        .from("user_roles")
        .update({ role })
        .eq("organization_id", ctx.organizationId)
        .eq("user_id", userId);
      if (error) throw toRepositoryError(error, "Could not change the role");
    },
  };
}
