import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../setup/documentFixtures";
import { FakeOcrClient } from "../setup/fakeOcrClient";
import { NoOpMalwareScanner } from "@/lib/documents/malwareScanner";
import { uploadDocumentsService, DocumentServiceError, documentErrorStatus, type UploadFileInput } from "@/lib/documents/service";
import {
  confirmExtractedFieldService,
  correctExtractedFieldService,
  markExtractedFieldAbsentService,
  listExtractedFieldsService,
  getClassificationResultService,
} from "@/lib/documents/extractedFieldsService";

function jpeg(name: string): UploadFileInput {
  return {
    originalFilename: name,
    buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`unique:${uniqueSuffix()}-padding`)]),
  };
}

describe("documents/extractedFieldsService", () => {
  let fx: Fixtures;
  let dfx: DocumentFixtures;
  const scanner = new NoOpMalwareScanner();
  const ocr = new FakeOcrClient();
  let dateFieldId: string;
  let otherTypeFieldId: string; // belongs to a different Document Type — used to prove cross-type rejection

  beforeAll(async () => {
    fx = await buildFixtures();
    dfx = await buildDocumentFixtures(fx);

    const dateField = await testDb.extractionFieldDefinition.create({
      data: {
        documentTypeId: dfx.invoiceType.id,
        code: "examination_date",
        label: "Examination Date",
        valueType: "date",
        required: true,
      },
    });
    dateFieldId = dateField.id;

    const otherField = await testDb.extractionFieldDefinition.create({
      data: { documentTypeId: dfx.medicalReportType.id, code: "diagnosis", label: "Diagnosis", valueType: "string" },
    });
    otherTypeFieldId = otherField.id;
  });

  afterAll(async () => {
    await testDb.extractedField.deleteMany({ where: { fieldDefinitionId: { in: [dateFieldId, otherTypeFieldId] } } });
    await testDb.extractionFieldDefinition.deleteMany({ where: { id: { in: [dateFieldId, otherTypeFieldId] } } });
    await dfx.cleanup();
    await fx.cleanup();
  });

  /**
   * A confirmed "invoice" Document on the Scheme-pinned connected Case.
   * Uploading with a pre-set type code makes uploadDocumentsService's own
   * pipeline run deterministic extraction immediately — against a JPEG with
   * no usable text, that auto-creates "unreadable" placeholder rows for
   * every configured field. Cleared here so each test starts from the
   * exact state it declares, not whatever the pipeline happened to leave.
   */
  async function newConfirmedInvoiceDocument(): Promise<{ documentId: string; documentVersionId: string }> {
    const [result] = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [jpeg("invoice.jpg")], "invoice")
    );
    const documentId = result.documentId!;
    const documentVersionId = result.versionId!;
    await testDb.extractedField.deleteMany({ where: { documentVersionId } });
    return { documentId, documentVersionId };
  }

  it("confirm requires an existing extracted value — 409 invalid_state without one", async () => {
    const { documentId } = await newConfirmedInvoiceDocument();
    await expect(
      testDb.$transaction((tx) => confirmExtractedFieldService(tx, fx.authFor("providerUserConnected"), documentId, dateFieldId))
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("confirm sets status=confirmed and copies the machine value into confirmedValue", async () => {
    const { documentId, documentVersionId } = await newConfirmedInvoiceDocument();
    await testDb.extractedField.create({
      data: {
        caseId: dfx.connectedCase.id,
        documentId,
        documentVersionId,
        fieldDefinitionId: dateFieldId,
        rawValue: "12.08.2026",
        normalizedValue: "2026-08-12",
        valueType: "date",
        status: "extracted",
        extractionMethod: "deterministic_parser",
      },
    });

    const confirmed = await testDb.$transaction((tx) =>
      confirmExtractedFieldService(tx, fx.authFor("providerUserConnected"), documentId, dateFieldId)
    );
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedValue).toBe("2026-08-12");
    expect(confirmed.confirmedByUserId).toBe(fx.providerUserConnected.id);
  });

  it("correct works with no pre-existing row (provider_entered) and normalizes the input", async () => {
    const { documentId } = await newConfirmedInvoiceDocument();
    const corrected = await testDb.$transaction((tx) =>
      correctExtractedFieldService(tx, fx.authFor("providerUserConnected"), documentId, dateFieldId, "01.01.2027", undefined)
    );
    expect(corrected.status).toBe("corrected");
    expect(corrected.extractionMethod).toBe("provider_entered");
    expect(corrected.rawValue).toBeNull(); // no machine value ever existed
    expect(corrected.confirmedValue).toBe("2027-01-01");
  });

  it("correct on an existing machine value preserves the original rawValue and only changes confirmedValue", async () => {
    const { documentId, documentVersionId } = await newConfirmedInvoiceDocument();
    await testDb.extractedField.create({
      data: {
        caseId: dfx.connectedCase.id,
        documentId,
        documentVersionId,
        fieldDefinitionId: dateFieldId,
        rawValue: "12.08.2026",
        normalizedValue: "2026-08-12",
        valueType: "date",
        status: "extracted",
        extractionMethod: "deterministic_parser",
      },
    });

    const corrected = await testDb.$transaction((tx) =>
      correctExtractedFieldService(tx, fx.authFor("providerUserConnected"), documentId, dateFieldId, "15.03.2027", "misread by OCR")
    );
    expect(corrected.rawValue).toBe("12.08.2026"); // untouched
    expect(corrected.normalizedValue).toBe("2026-08-12"); // untouched
    expect(corrected.confirmedValue).toBe("2027-03-15");
    expect(corrected.correctionReason).toBe("misread by OCR");
    expect(corrected.status).toBe("corrected");
  });

  it("correct rejects a value that cannot be parsed as the field's type — 422 invalid_value", async () => {
    const { documentId } = await newConfirmedInvoiceDocument();
    await expect(
      testDb.$transaction((tx) => correctExtractedFieldService(tx, fx.authFor("providerUserConnected"), documentId, dateFieldId, "not a date", undefined))
    ).rejects.toMatchObject({ code: "invalid_value" });
    expect(documentErrorStatus("invalid_value")).toBe(422);
  });

  it("mark-absent sets status=absent with no confirmedValue", async () => {
    const { documentId } = await newConfirmedInvoiceDocument();
    const absent = await testDb.$transaction((tx) =>
      markExtractedFieldAbsentService(tx, fx.authFor("providerUserConnected"), documentId, dateFieldId)
    );
    expect(absent.status).toBe("absent");
    expect(absent.confirmedValue).toBeNull();
  });

  it("a field definition belonging to a different Document Type is rejected — 404 not_found", async () => {
    const { documentId } = await newConfirmedInvoiceDocument(); // confirmed as "invoice", not "medical_report"
    await expect(
      testDb.$transaction((tx) => confirmExtractedFieldService(tx, fx.authFor("providerUserConnected"), documentId, otherTypeFieldId))
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("a Client Admin is forbidden from all three mutations but can still read", async () => {
    const { documentId } = await newConfirmedInvoiceDocument();
    const clientAdmin = fx.authFor("clientAdminA");

    await expect(testDb.$transaction((tx) => correctExtractedFieldService(tx, clientAdmin, documentId, dateFieldId, "01.01.2027", undefined))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(testDb.$transaction((tx) => markExtractedFieldAbsentService(tx, clientAdmin, documentId, dateFieldId))).rejects.toMatchObject({
      code: "forbidden",
    });

    const fields = await testDb.$transaction((tx) => listExtractedFieldsService(tx, clientAdmin, documentId));
    expect(Array.isArray(fields)).toBe(true);
    const classification = await testDb.$transaction((tx) => getClassificationResultService(tx, clientAdmin, documentId));
    expect(classification).toBeNull();
  });

  it("a Super Admin gets not_found on every action, matching Document's zero-visibility rule", async () => {
    const { documentId } = await newConfirmedInvoiceDocument();
    const superAdmin = fx.authFor("superAdmin");

    await expect(testDb.$transaction((tx) => correctExtractedFieldService(tx, superAdmin, documentId, dateFieldId, "01.01.2027", undefined))).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(testDb.$transaction((tx) => listExtractedFieldsService(tx, superAdmin, documentId))).rejects.toMatchObject({ code: "not_found" });
    await expect(testDb.$transaction((tx) => getClassificationResultService(tx, superAdmin, documentId))).rejects.toMatchObject({ code: "not_found" });
  });

  it("listExtractedFieldsService merges configured field definitions with any existing ExtractedField, defaulting to not_extracted", async () => {
    const { documentId } = await newConfirmedInvoiceDocument();
    const fields = await testDb.$transaction((tx) => listExtractedFieldsService(tx, fx.authFor("providerUserConnected"), documentId));
    const dateRow = fields.find((f) => f.fieldDefinitionId === dateFieldId);
    expect(dateRow).toMatchObject({ status: "not_extracted", rawValue: null, code: "examination_date" });
  });

  it("throws DocumentServiceError instances catchable the same way as the rest of the document service", async () => {
    const { documentId } = await newConfirmedInvoiceDocument();
    try {
      await testDb.$transaction((tx) => confirmExtractedFieldService(tx, fx.authFor("providerUserConnected"), documentId, dateFieldId));
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentServiceError);
    }
  });
});
