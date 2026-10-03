import type { Repository, RepositoryContext } from "@/lib/data/types";
import { createDemoCustomerRepository, createDemoItemRepository } from "./catalog-repos";
import { createDemoDocumentRepository } from "./document-repo";
import {
  createDemoAttachmentRepository,
  createDemoAuditRepository,
  createDemoEmailLogRepository,
  createDemoPaymentRepository,
  createDemoSettlementRepository,
} from "./finance-repos";
import {
  createDemoOrganizationRepository,
  createDemoPaymentDestinationRepository,
  createDemoSequenceRepository,
  createDemoTaxRepository,
  createDemoTeamRepository,
} from "./settings-repos";
import { DEMO_ORGANIZATION_ID, DEMO_USER_EMAIL, DEMO_USER_ID } from "./state";
import { getFileDemoStore, type DemoStore } from "./store";

const MAX_AUDIT_ROWS = 2000;

export const DEMO_CONTEXT: RepositoryContext = {
  organizationId: DEMO_ORGANIZATION_ID,
  userId: DEMO_USER_ID,
  userEmail: DEMO_USER_EMAIL,
};

/** Repository backed by a demo store (file-backed in the app, in-memory in tests). */
export function createDemoRepository(
  store: DemoStore = getFileDemoStore(),
  context: RepositoryContext = DEMO_CONTEXT,
): Repository {
  return {
    mode: "demo",
    context,
    organization: createDemoOrganizationRepository(store),
    customers: createDemoCustomerRepository(store, context),
    items: createDemoItemRepository(store, context),
    taxes: createDemoTaxRepository(store, context),
    paymentDestinations: createDemoPaymentDestinationRepository(store, context),
    sequences: createDemoSequenceRepository(store),
    team: createDemoTeamRepository(store),
    documents: createDemoDocumentRepository(store, context),
    payments: createDemoPaymentRepository(store, context),
    settlement: createDemoSettlementRepository(store, context),
    emailLogs: createDemoEmailLogRepository(store, context),
    attachments: createDemoAttachmentRepository(store, context),
    audit: createDemoAuditRepository(store),
    writeAudit: (entry) =>
      store.write((state) => {
        state.audit_logs.push({
          id: (state.audit_logs[state.audit_logs.length - 1]?.id ?? 0) + 1,
          organization_id: context.organizationId,
          actor_id: context.userId,
          actor_email: context.userEmail,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId ?? null,
          before_data: entry.before ?? null,
          after_data: entry.after ?? null,
          metadata: entry.metadata ?? {},
          ip_address: null,
          user_agent: null,
          created_at: new Date().toISOString(),
        });
        if (state.audit_logs.length > MAX_AUDIT_ROWS) state.audit_logs.splice(0, state.audit_logs.length - MAX_AUDIT_ROWS);
      }),
  };
}
