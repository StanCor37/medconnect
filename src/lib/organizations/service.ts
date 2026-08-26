import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";
export { AccountServiceError } from "@/lib/accounts/service";
import { AccountServiceError } from "@/lib/accounts/service";
import {
  checkForDuplicateProvider,
  normalizeProviderName,
} from "@/lib/duplicate-detection/provider";
import { writeAuditEvent } from "@/lib/audit/record";
import type { CreateClientInput, CreateProviderInput } from "@/lib/validation/organization";

export async function createClientService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  input: CreateClientInput
) {
  if (actor.role !== "super_admin") {
    throw new AccountServiceError("forbidden", "Only Super Admin can create Clients");
  }

  const client = await tx.client.create({
    data: { legalName: input.legalName, capabilities: input.capabilities },
  });

  await writeAuditEvent(tx, {
    eventType: "client_created",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: client.id,
    targetType: "Client",
    targetId: client.id,
    action: "create",
    source: "api",
  });

  return client;
}

/**
 * Creates a Provider. Super Admin creates standalone Providers; Client Admin
 * creates Providers connected to their own Client from birth (an
 * immediately-active relationship, distinct from the pending/accept flow
 * used to connect an EXISTING standalone Provider — see
 * `createRelationshipService`).
 */
export async function createProviderService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  input: CreateProviderInput
) {
  if (actor.role !== "super_admin" && actor.role !== "client_admin") {
    throw new AccountServiceError("forbidden", "Only Super Admin or Client Admin can create Providers");
  }

  const duplicate = await checkForDuplicateProvider(tx, input);
  if (duplicate.kind === "exact_match") {
    throw new AccountServiceError(
      "duplicate_provider",
      `A Provider with the same ${duplicate.reason === "tax_id" ? "tax ID" : "registration number"} already exists in this country.`
    );
  }
  if (duplicate.kind === "probable_match" && !input.confirmedNotDuplicateBy) {
    throw new AccountServiceError(
      "probable_duplicate_provider",
      "Possible duplicate Providers were found. Confirm this is not a duplicate to proceed."
    );
  }

  const provider = await tx.provider.create({
    data: {
      legalName: input.legalName,
      normalizedName: normalizeProviderName(input.legalName),
      country: input.country,
      officialRegistrationNumber: input.officialRegistrationNumber ?? null,
      taxId: input.taxId ?? null,
      healthcareLicenseNumber: input.healthcareLicenseNumber ?? null,
      addressLine: input.addressLine ?? null,
      city: input.city ?? null,
      postalCode: input.postalCode ?? null,
      mode: actor.role === "client_admin" ? "client_connected" : "standalone",
      createdBySuperAdminId: actor.role === "super_admin" ? actor.userId : null,
      createdByClientAdminId: actor.role === "client_admin" ? actor.userId : null,
    },
  });

  let relationshipId: string | null = null;
  if (actor.role === "client_admin") {
    const relationship = await tx.providerClientRelationship.create({
      data: {
        providerId: provider.id,
        clientId: actor.clientId!,
        status: "active",
        activatedAt: new Date(),
      },
    });
    relationshipId = relationship.id;
  }

  await writeAuditEvent(tx, {
    eventType: "provider_created",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: provider.id,
    clientId: actor.role === "client_admin" ? actor.clientId : null,
    relationshipId,
    targetType: "Provider",
    targetId: provider.id,
    action: "create",
    source: "api",
    reasonCode: duplicate.kind === "probable_match" ? "confirmed_not_duplicate" : null,
  });

  return { provider, duplicateWarning: duplicate.kind === "probable_match" ? duplicate : null };
}

/** Client Admin requests connecting to an EXISTING standalone Provider (Segment 2 §9). */
export async function createRelationshipService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  providerId: string
) {
  if (actor.role !== "client_admin") {
    throw new AccountServiceError("forbidden", "Only Client Admin can request a Provider connection");
  }
  const provider = await tx.provider.findUnique({ where: { id: providerId } });
  if (!provider) throw new AccountServiceError("not_found", "Provider not found");

  const existing = await tx.providerClientRelationship.findUnique({
    where: { providerId_clientId: { providerId, clientId: actor.clientId! } },
  });
  if (existing) {
    throw new AccountServiceError(
      "relationship_exists",
      `A relationship with this Provider already exists (status: ${existing.status}).`
    );
  }

  const relationship = await tx.providerClientRelationship.create({
    data: { providerId, clientId: actor.clientId!, status: "pending" },
  });

  await writeAuditEvent(tx, {
    eventType: "provider_client_connection_requested",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId,
    clientId: actor.clientId,
    relationshipId: relationship.id,
    targetType: "ProviderClientRelationship",
    targetId: relationship.id,
    action: "request",
    source: "api",
  });

  return relationship;
}

async function recomputeProviderMode(tx: Prisma.TransactionClient, providerId: string) {
  const activeCount = await tx.providerClientRelationship.count({
    where: { providerId, status: "active" },
  });
  await tx.provider.update({
    where: { id: providerId },
    data: { mode: activeCount > 0 ? "client_connected" : "standalone" },
  });
}

/** An authorized Provider User accepts a pending relationship for their own Provider. */
export async function activateRelationshipService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  relationshipId: string
) {
  const relationship = await tx.providerClientRelationship.findUnique({
    where: { id: relationshipId },
  });
  if (!relationship) throw new AccountServiceError("not_found", "Relationship not found");
  if (actor.role === "provider_user" && relationship.providerId !== actor.providerId) {
    throw new AccountServiceError("forbidden", "Not your Provider's relationship");
  }
  if (actor.role === "client_admin" && relationship.clientId !== actor.clientId) {
    throw new AccountServiceError("forbidden", "Not your Client's relationship");
  }
  if (relationship.status !== "pending") {
    throw new AccountServiceError("invalid_state", `Relationship is ${relationship.status}, not pending`);
  }

  const updated = await tx.providerClientRelationship.update({
    where: { id: relationshipId },
    data: { status: "active", activatedAt: new Date() },
  });
  await recomputeProviderMode(tx, relationship.providerId);

  await writeAuditEvent(tx, {
    eventType: "provider_client_connection_activated",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: relationship.providerId,
    clientId: relationship.clientId,
    relationshipId: relationship.id,
    targetType: "ProviderClientRelationship",
    targetId: relationship.id,
    action: "activate",
    source: "api",
  });

  return updated;
}

type RelationshipTerminalAction = "suspend" | "terminate";

export async function changeRelationshipStatusService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  relationshipId: string,
  action: RelationshipTerminalAction
) {
  if (actor.role !== "client_admin") {
    throw new AccountServiceError("forbidden", "Only Client Admin can suspend or terminate a relationship");
  }
  const relationship = await tx.providerClientRelationship.findUnique({
    where: { id: relationshipId },
  });
  if (!relationship || relationship.clientId !== actor.clientId) {
    throw new AccountServiceError("not_found", "Relationship not found");
  }

  const now = new Date();
  const updated = await tx.providerClientRelationship.update({
    where: { id: relationshipId },
    data:
      action === "suspend"
        ? { status: "suspended", suspendedAt: now }
        : { status: "terminated", terminatedAt: now },
  });
  // Isolation: this only ever touches this one relationship row — a Provider's
  // other Client relationships are untouched (Segment 2 §3).
  await recomputeProviderMode(tx, relationship.providerId);

  await writeAuditEvent(tx, {
    eventType:
      action === "suspend"
        ? "provider_client_connection_suspended"
        : "provider_client_connection_terminated",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: relationship.providerId,
    clientId: relationship.clientId,
    relationshipId: relationship.id,
    targetType: "ProviderClientRelationship",
    targetId: relationship.id,
    action,
    source: "api",
  });

  return updated;
}
