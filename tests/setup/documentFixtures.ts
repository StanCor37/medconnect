import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { testDb, uniqueSuffix } from "./testDb";
import { LocalFilesystemStorageAdapter } from "@/lib/storage/LocalFilesystemStorageAdapter";
import type { Fixtures } from "./fixtures";

/**
 * Builds one isolated set of Documents-related fixtures per test run,
 * layered on top of an existing `Fixtures` set. Kept in a separate file (not
 * added to fixtures.ts) so unrelated test files stay unaffected, matching
 * ruleFixtures.ts's precedent. Storage uses the REAL LocalFilesystemStorageAdapter
 * against a scratch temp directory — not a fake — so tests exercise genuine
 * filesystem code while staying fully isolated from storage/documents/.
 */
export async function buildDocumentFixtures(fx: Fixtures) {
  const s = uniqueSuffix();

  // Minimal published ValidationSchemeVersion (Client A-owned) with 2 Document Types.
  const scheme = await testDb.validationScheme.create({
    data: {
      scope: "client",
      clientId: fx.clientA.id,
      name: `Test Doc Scheme ${s}`,
      countryCodes: [],
      status: "draft",
      createdByUserId: fx.clientAdminA.id,
    },
  });
  const schemeVersion = await testDb.validationSchemeVersion.create({
    data: { schemeId: scheme.id, versionNumber: 1, publishedAt: new Date(), publishedByUserId: fx.clientAdminA.id },
  });
  await testDb.validationScheme.update({
    where: { id: scheme.id },
    data: { currentVersionId: schemeVersion.id, status: "published" },
  });
  const medicalReportType = await testDb.documentTypeDefinition.create({
    data: { schemeVersionId: schemeVersion.id, code: "medical_report", name: "Medical report", required: true, displayOrder: 0 },
  });
  const invoiceType = await testDb.documentTypeDefinition.create({
    data: { schemeVersionId: schemeVersion.id, code: "invoice", name: "Invoice", required: true, displayOrder: 1 },
  });
  // Deliberately NOT in GENERAL_DOCUMENT_TYPES — proves a Scheme-configured
  // code doesn't leak into the no-Scheme fallback list and vice versa.
  const labResultType = await testDb.documentTypeDefinition.create({
    data: { schemeVersionId: schemeVersion.id, code: "lab_result", name: "Laboratory result", required: false, displayOrder: 2 },
  });

  // Standalone Case — no Scheme pinned, exercises the general-fallback-type-list path.
  const standaloneCase = await testDb.case.create({
    data: {
      internalReference: `MC-TEST-${uniqueSuffix()}`,
      caseMode: "standalone",
      providerId: fx.providerStandalone.id,
      createdByUserId: fx.providerUserStandalone.id,
    },
  });

  // Client-connected, provider_shared Case, shared with Client A, Scheme pinned.
  const connectedCase = await testDb.case.create({
    data: {
      internalReference: `MC-TEST-${uniqueSuffix()}`,
      caseMode: "client_connected",
      providerId: fx.providerConnected.id,
      createdByUserId: fx.providerUserConnected.id,
      clientId: fx.clientA.id,
      providerClientRelationshipId: fx.activeRelationship.id,
      validationSchemeVersionId: schemeVersion.id,
    },
  });

  // creator_only Case (same connected Provider) — colleague-exclusion fixture.
  const creatorOnlyCase = await testDb.case.create({
    data: {
      internalReference: `MC-TEST-${uniqueSuffix()}`,
      caseMode: "standalone",
      providerId: fx.providerConnected.id,
      createdByUserId: fx.providerUserConnected.id,
      providerCaseAccess: "creator_only",
    },
  });

  // Shared with Client B via fx.pendingRelationship — a PENDING relationship
  // must grant zero visibility, unlike the active one connectedCase uses.
  const pendingRelationshipCase = await testDb.case.create({
    data: {
      internalReference: `MC-TEST-${uniqueSuffix()}`,
      caseMode: "client_connected",
      providerId: fx.providerConnected.id,
      createdByUserId: fx.providerUserConnected.id,
      clientId: fx.clientB.id,
      providerClientRelationshipId: fx.pendingRelationship.id,
    },
  });

  const storageRoot = path.join(os.tmpdir(), "medconnect-test-storage", s);
  const storage = new LocalFilesystemStorageAdapter(storageRoot);

  const caseIds = [standaloneCase.id, connectedCase.id, creatorOnlyCase.id, pendingRelationshipCase.id];
  const schemeIds = [scheme.id];

  async function cleanup() {
    await testDb.documentPageReference.deleteMany({ where: { sourceFile: { caseId: { in: caseIds } } } });
    await testDb.document.updateMany({ where: { caseId: { in: caseIds } }, data: { currentVersionId: null } });
    // Segment 6 processing artifacts have no cascade — clean up explicitly
    // before deleting their parent DocumentVersion rows.
    await testDb.extractedField.deleteMany({ where: { document: { caseId: { in: caseIds } } } });
    await testDb.documentClassificationResult.deleteMany({ where: { documentVersion: { document: { caseId: { in: caseIds } } } } });
    await testDb.ocrPageResult.deleteMany({ where: { documentVersion: { document: { caseId: { in: caseIds } } } } });
    await testDb.documentProcessingJob.deleteMany({ where: { documentVersion: { document: { caseId: { in: caseIds } } } } });
    await testDb.documentVersion.deleteMany({ where: { document: { caseId: { in: caseIds } } } });
    await testDb.document.deleteMany({ where: { caseId: { in: caseIds } } });
    await testDb.sourceFile.deleteMany({ where: { caseId: { in: caseIds } } });
    await testDb.case.deleteMany({ where: { id: { in: caseIds } } });

    await testDb.extractionFieldDefinition.deleteMany({ where: { documentType: { schemeVersionId: schemeVersion.id } } });
    await testDb.documentTypeDefinition.deleteMany({ where: { schemeVersionId: schemeVersion.id } });
    await testDb.validationScheme.updateMany({ where: { id: { in: schemeIds } }, data: { currentVersionId: null } });
    await testDb.validationSchemeVersion.deleteMany({ where: { schemeId: { in: schemeIds } } });
    await testDb.validationScheme.deleteMany({ where: { id: { in: schemeIds } } });

    await fs.promises.rm(storageRoot, { recursive: true, force: true });
  }

  return {
    suffix: s,
    scheme,
    schemeVersion,
    medicalReportType,
    invoiceType,
    labResultType,
    standaloneCase,
    connectedCase,
    creatorOnlyCase,
    pendingRelationshipCase,
    storage,
    storageRoot,
    cleanup,
  };
}

export type DocumentFixtures = Awaited<ReturnType<typeof buildDocumentFixtures>>;
