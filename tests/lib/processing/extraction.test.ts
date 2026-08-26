import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../../setup/testDb";
import { buildFixtures, type Fixtures } from "../../setup/fixtures";
import { buildDocumentFixtures, type DocumentFixtures } from "../../setup/documentFixtures";
import { NoOpMalwareScanner } from "@/lib/documents/malwareScanner";
import { FakeOcrClient } from "../../setup/fakeOcrClient";
import { uploadDocumentsService, type UploadFileInput } from "@/lib/documents/service";
import { runDeterministicExtraction } from "@/lib/processing/extraction";

// Content must be unique per call, or checkForDuplicateDocumentInCase flags
// the 2nd+ upload as an exact-match duplicate and returns no versionId.
function jpeg(name: string): UploadFileInput {
  return {
    originalFilename: name,
    buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`unique:${uniqueSuffix()}-padding-bytes`)]),
  };
}

describe("processing/extraction", () => {
  let fx: Fixtures;
  let dfx: DocumentFixtures;
  const scanner = new NoOpMalwareScanner();
  const ocr = new FakeOcrClient();
  let dateFieldId: string;
  let moneyFieldId: string;
  let nameFieldId: string;

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
        extractionHints: ["Examination Date:\\s*([0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{4})"],
      },
    });
    dateFieldId = dateField.id;

    const moneyField = await testDb.extractionFieldDefinition.create({
      data: {
        documentTypeId: dfx.invoiceType.id,
        code: "total_cost",
        label: "Total Cost",
        valueType: "money",
        required: true,
        extractionHints: ["Total:\\s*([0-9.,]+\\s*(?:EUR|RSD)?)"],
      },
    });
    moneyFieldId = moneyField.id;

    const nameField = await testDb.extractionFieldDefinition.create({
      data: {
        documentTypeId: dfx.invoiceType.id,
        code: "patient_full_name",
        label: "Patient Full Name",
        valueType: "string",
        required: true,
        extractionHints: ["Patient:\\s*([^\\n]+)"],
      },
    });
    nameFieldId = nameField.id;
  });

  afterAll(async () => {
    await testDb.extractedField.deleteMany({ where: { fieldDefinitionId: { in: [dateFieldId, moneyFieldId, nameFieldId] } } });
    await testDb.extractionFieldDefinition.deleteMany({ where: { id: { in: [dateFieldId, moneyFieldId, nameFieldId] } } });
    await dfx.cleanup();
    await fx.cleanup();
  });

  async function newVersion(): Promise<{ caseId: string; documentId: string; documentVersionId: string }> {
    const [result] = await testDb.$transaction((tx) =>
      uploadDocumentsService(tx, dfx.storage, scanner, ocr, fx.authFor("providerUserConnected"), dfx.connectedCase.id, [jpeg("scan.jpg")], undefined)
    );
    return { caseId: dfx.connectedCase.id, documentId: result.documentId!, documentVersionId: result.versionId! };
  }

  it("extracts and normalizes matching fields; a regex miss leaves the field unprocessed rather than inventing absent", async () => {
    const v = await newVersion();
    await testDb.$transaction((tx) =>
      runDeterministicExtraction(tx, {
        caseId: v.caseId,
        documentId: v.documentId,
        documentVersionId: v.documentVersionId,
        schemeVersionId: dfx.schemeVersion.id,
        confirmedTypeCode: "invoice",
        sourceFileContentHash: `hash-${v.documentVersionId}`,
        pageTexts: ["Patient: Jane Doe\nExamination Date: 12.08.2026\nTotal: 90.00 EUR"],
      })
    );

    const dateRow = await testDb.extractedField.findUniqueOrThrow({
      where: { documentVersionId_fieldDefinitionId: { documentVersionId: v.documentVersionId, fieldDefinitionId: dateFieldId } },
    });
    expect(dateRow.status).toBe("extracted");
    expect(dateRow.normalizedValue).toBe("2026-08-12");

    const moneyRow = await testDb.extractedField.findUniqueOrThrow({
      where: { documentVersionId_fieldDefinitionId: { documentVersionId: v.documentVersionId, fieldDefinitionId: moneyFieldId } },
    });
    expect(moneyRow.status).toBe("extracted");
    expect(moneyRow.normalizedValue).toEqual({ minorUnits: 9000, currency: "EUR" });

    const nameRow = await testDb.extractedField.findUniqueOrThrow({
      where: { documentVersionId_fieldDefinitionId: { documentVersionId: v.documentVersionId, fieldDefinitionId: nameFieldId } },
    });
    expect(nameRow.rawValue).toBe("Jane Doe");
  });

  it("no usable text marks every field unreadable, not absent", async () => {
    const v = await newVersion();
    await testDb.$transaction((tx) =>
      runDeterministicExtraction(tx, {
        caseId: v.caseId,
        documentId: v.documentId,
        documentVersionId: v.documentVersionId,
        schemeVersionId: dfx.schemeVersion.id,
        confirmedTypeCode: "invoice",
        sourceFileContentHash: `hash-${v.documentVersionId}`,
        pageTexts: [""],
      })
    );
    const dateRow = await testDb.extractedField.findUniqueOrThrow({
      where: { documentVersionId_fieldDefinitionId: { documentVersionId: v.documentVersionId, fieldDefinitionId: dateFieldId } },
    });
    expect(dateRow.status).toBe("unreadable");
    expect(dateRow.rawValue).toBeNull();
  });

  it("a regex miss on one field does not create a row for it, while sibling fields still extract", async () => {
    const v = await newVersion();
    await testDb.$transaction((tx) =>
      runDeterministicExtraction(tx, {
        caseId: v.caseId,
        documentId: v.documentId,
        documentVersionId: v.documentVersionId,
        schemeVersionId: dfx.schemeVersion.id,
        confirmedTypeCode: "invoice",
        sourceFileContentHash: `hash-${v.documentVersionId}`,
        pageTexts: ["Total: 15.50 RSD"], // no Patient/Examination Date labels present
      })
    );
    const count = await testDb.extractedField.count({
      where: { documentVersionId: v.documentVersionId, fieldDefinitionId: { in: [dateFieldId, nameFieldId] } },
    });
    expect(count).toBe(0);
    const moneyRow = await testDb.extractedField.findUniqueOrThrow({
      where: { documentVersionId_fieldDefinitionId: { documentVersionId: v.documentVersionId, fieldDefinitionId: moneyFieldId } },
    });
    expect(moneyRow.normalizedValue).toEqual({ minorUnits: 1550, currency: "RSD" });
  });

  it("a confirmed field is never overwritten by a later automatic run", async () => {
    const v = await newVersion();
    const run = () =>
      testDb.$transaction((tx) =>
        runDeterministicExtraction(tx, {
          caseId: v.caseId,
          documentId: v.documentId,
          documentVersionId: v.documentVersionId,
          schemeVersionId: dfx.schemeVersion.id,
          confirmedTypeCode: "invoice",
          sourceFileContentHash: `hash-${v.documentVersionId}`,
          pageTexts: ["Patient: Jane Doe\nExamination Date: 12.08.2026\nTotal: 90.00 EUR"],
        })
      );
    await run();
    await testDb.extractedField.update({
      where: { documentVersionId_fieldDefinitionId: { documentVersionId: v.documentVersionId, fieldDefinitionId: nameFieldId } },
      data: { status: "confirmed", confirmedValue: "Jane A. Doe", confirmedByUserId: fx.providerUserConnected.id, confirmedAt: new Date() },
    });

    // Second run's hash differs (forced retry), text now says a different name.
    await testDb.$transaction((tx) =>
      runDeterministicExtraction(tx, {
        caseId: v.caseId,
        documentId: v.documentId,
        documentVersionId: v.documentVersionId,
        schemeVersionId: dfx.schemeVersion.id,
        confirmedTypeCode: "invoice",
        sourceFileContentHash: `hash-${v.documentVersionId}-retry`,
        pageTexts: ["Patient: Someone Else\nExamination Date: 01.01.2027\nTotal: 10.00 EUR"],
      })
    );

    const nameRow = await testDb.extractedField.findUniqueOrThrow({
      where: { documentVersionId_fieldDefinitionId: { documentVersionId: v.documentVersionId, fieldDefinitionId: nameFieldId } },
    });
    expect(nameRow.status).toBe("confirmed");
    expect(nameRow.rawValue).toBe("Jane Doe");

    const dateRow = await testDb.extractedField.findUniqueOrThrow({
      where: { documentVersionId_fieldDefinitionId: { documentVersionId: v.documentVersionId, fieldDefinitionId: dateFieldId } },
    });
    expect(dateRow.normalizedValue).toBe("2027-01-01");
  });

  it("other_document / a type with no real DocumentTypeDefinition row is a clean no-op", async () => {
    const v = await newVersion();
    await expect(
      testDb.$transaction((tx) =>
        runDeterministicExtraction(tx, {
          caseId: v.caseId,
          documentId: v.documentId,
          documentVersionId: v.documentVersionId,
          schemeVersionId: dfx.schemeVersion.id,
          confirmedTypeCode: "other_document",
          sourceFileContentHash: `hash-${v.documentVersionId}`,
          pageTexts: ["Patient: Jane Doe"],
        })
      )
    ).resolves.toBeUndefined();
    const count = await testDb.extractedField.count({ where: { documentVersionId: v.documentVersionId } });
    expect(count).toBe(0);
  });
});
