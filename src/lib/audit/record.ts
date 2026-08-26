import type { Prisma } from "@/generated/prisma/client";

/**
 * The Segment 11 event vocabulary this phase can emit. Extend as later
 * segments land (Case, Document, Rule, Validation events) — do not widen this
 * to an unchecked free-text string, since the audit log's value depends on a
 * closed, meaningful set of event types.
 */
export type AuditEventType =
  | "user_invited"
  | "user_activated"
  | "user_updated"
  | "user_suspended"
  | "user_deactivated"
  | "user_deleted"
  | "password_reset_requested"
  | "login_succeeded"
  | "login_failed"
  | "provider_created"
  | "client_created" // not in Segment 11's literal list but required by its own "record permission-sensitive actions" rule — Segment 11 never itemizes a Client-creation event
  | "provider_client_connection_requested"
  | "provider_client_connection_activated"
  | "provider_client_connection_suspended"
  | "provider_client_connection_terminated"
  | "case_created"
  | "case_updated"
  | "case_insurer_recognized"
  | "case_shared_with_client"
  | "case_assigned"
  | "case_duplicate_warning_overridden"
  | "case_archived"
  | "case_restored"
  | "case_deleted" // not in Segment 11's literal list — same precedent as client_created
  | "case_scheme_assigned" // reserved by Segment 4's own audit vocabulary, actually emitted starting Segment 3
  | "case_scheme_changed"
  | "rule_created"
  | "rule_version_created"
  | "rule_version_updated"
  | "rule_published"
  | "rule_archived"
  | "rule_deleted"
  | "rule_promoted"
  | "rule_duplicate_warning_overridden"
  | "scheme_created"
  | "scheme_rule_added"
  | "scheme_rule_updated"
  | "scheme_rule_removed"
  | "scheme_published"
  | "scheme_archived"
  | "scheme_deleted"
  | "scheme_document_type_added"
  | "scheme_document_type_updated"
  | "scheme_document_type_removed"
  | "source_file_uploaded"
  | "document_created"
  | "document_type_confirmed"
  | "document_type_changed"
  | "document_version_created"
  | "document_replaced"
  | "document_archived"
  | "document_deleted"
  // Segment 6 — reserved now, not emitted anywhere yet (no service code this
  // phase); same "pre-reserve before the emitting segment exists" precedent
  // as case_scheme_assigned before Segment 3.
  | "document_processing_started"
  | "document_text_extracted"
  | "document_ocr_completed"
  | "document_classification_suggested"
  | "document_classification_confirmed"
  | "document_classification_corrected"
  | "document_extraction_completed"
  | "extracted_field_confirmed"
  | "extracted_field_corrected"
  | "extracted_field_marked_absent"
  | "document_processing_retried"
  | "document_processing_failed";

export interface AuditEventInput {
  eventType: AuditEventType;
  actorUserId: string | null;
  actorRole: "super_admin" | "client_admin" | "provider_user" | null;
  providerId?: string | null;
  clientId?: string | null;
  relationshipId?: string | null;
  caseId?: string | null;
  targetType: string;
  targetId: string;
  action: string;
  source: "ui" | "api" | "system";
  reasonCode?: string | null;
}

/**
 * Writes one append-only AuditEvent row. Never pass document text, extracted
 * medical values, patient names, or free-form notes here — only safe
 * identifiers and enumerated reason codes (Segment 11 §10-11).
 */
export async function writeAuditEvent(
  tx: Prisma.TransactionClient,
  input: AuditEventInput
) {
  await tx.auditEvent.create({
    data: {
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      providerId: input.providerId ?? null,
      clientId: input.clientId ?? null,
      relationshipId: input.relationshipId ?? null,
      caseId: input.caseId ?? null,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      source: input.source,
      reasonCode: input.reasonCode ?? null,
    },
  });
}
