import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit/log";
import type { Repository, RepositoryContext } from "@/lib/data/types";
import type { Database } from "@/types/database";
import { createSupabaseCustomerRepository, createSupabaseItemRepository } from "./catalog-repos";
import { createSupabaseDocumentRepository } from "./document-repo";
import {
  createSupabaseAttachmentRepository,
  createSupabaseAuditRepository,
  createSupabaseEmailLogRepository,
  createSupabasePaymentRepository,
  createSupabaseSettlementRepository,
} from "./finance-repos";
import {
  createSupabaseOrganizationRepository,
  createSupabasePaymentDestinationRepository,
  createSupabaseSequenceRepository,
  createSupabaseTaxRepository,
  createSupabaseTeamRepository,
} from "./settings-repos";

export interface SupabaseRepositoryOptions {
  /** Lazily creates the service-role client (PDF storage writes). Omit to skip storage uploads. */
  adminClient?: () => SupabaseClient<Database>;
}

/** Production adapter. Pass the user-scoped client so Row Level Security applies to every call. */
export function createSupabaseRepository(
  db: SupabaseClient<Database>,
  context: RepositoryContext,
  options: SupabaseRepositoryOptions = {},
): Repository {
  return {
    mode: "supabase",
    context,
    organization: createSupabaseOrganizationRepository(db, context),
    customers: createSupabaseCustomerRepository(db, context),
    items: createSupabaseItemRepository(db, context),
    taxes: createSupabaseTaxRepository(db, context),
    paymentDestinations: createSupabasePaymentDestinationRepository(db, context),
    sequences: createSupabaseSequenceRepository(db, context),
    team: createSupabaseTeamRepository(db, context),
    documents: createSupabaseDocumentRepository(db, context, options.adminClient),
    payments: createSupabasePaymentRepository(db, context),
    settlement: createSupabaseSettlementRepository(db, context),
    emailLogs: createSupabaseEmailLogRepository(db, context),
    attachments: createSupabaseAttachmentRepository(db, context, options.adminClient),
    audit: createSupabaseAuditRepository(db, context),
    writeAudit: (entry) =>
      writeAuditLog(db, {
        ...entry,
        organizationId: context.organizationId,
        actorId: context.userId,
        actorEmail: context.userEmail,
      }),
  };
}
