import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import type { AuthContext } from "../src/lib/authz/can";
import { createDraftRuleService, publishRuleVersionService } from "../src/lib/rules/service";
import {
  createDraftSchemeService,
  addRuleToSchemeService,
  addDocumentTypeToSchemeService,
  publishSchemeVersionService,
} from "../src/lib/schemes/service";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DEV_PASSWORD = "DevPassword123!"; // seeded accounts only — never used outside local/dev

async function main() {
  console.log("Seeding fixture data (bypasses RLS via the owner connection)...");

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  const dunav = await prisma.insurer.create({
    data: { name: "Dunav Osiguranje a.d.o Beograd", country: "RS" },
  });
  await prisma.insurer.createMany({
    data: [
      { name: "DDOR Novi Sad", country: "RS" },
      { name: "Generali Osiguranje", country: "RS" },
      { name: "Wiener Städtische", country: "AT" },
      { name: "Allianz", country: "DE" },
    ],
  });

  const superAdmin = await prisma.user.create({
    data: {
      email: "super@medconnect.test",
      role: "super_admin",
      status: "active",
      passwordHash,
      firstName: "Sam",
      lastName: "SuperAdmin",
    },
  });

  const clientA = await prisma.client.create({
    data: {
      legalName: "Adria Assist d.o.o.",
      capabilities: ["assistance_company"],
    },
  });
  const clientB = await prisma.client.create({
    data: {
      legalName: "Balkan Re Insurance",
      capabilities: ["insurance_company", "assistance_company"],
    },
  });

  const clientAdminA = await prisma.user.create({
    data: {
      email: "admin.a@medconnect.test",
      role: "client_admin",
      status: "active",
      passwordHash,
      firstName: "Ana",
      lastName: "ClientAdmin",
      clientId: clientA.id,
      createdByUserId: superAdmin.id,
    },
  });
  await prisma.user.create({
    data: {
      email: "admin.b@medconnect.test",
      role: "client_admin",
      status: "active",
      passwordHash,
      firstName: "Boris",
      lastName: "ClientAdmin",
      clientId: clientB.id,
      createdByUserId: superAdmin.id,
    },
  });

  // Provider 1: standalone, created by Super Admin, no relationships.
  const providerStandalone = await prisma.provider.create({
    data: {
      legalName: "City Clinic",
      normalizedName: "city clinic",
      mode: "standalone",
      country: "RS",
      officialRegistrationNumber: "REG-0001",
      createdBySuperAdminId: superAdmin.id,
    },
  });
  await prisma.user.create({
    data: {
      email: "provider.standalone@medconnect.test",
      role: "provider_user",
      status: "active",
      passwordHash,
      firstName: "Pavle",
      lastName: "Standalone",
      providerId: providerStandalone.id,
      createdByUserId: superAdmin.id,
    },
  });

  // Provider 2: client-connected to Client A (active relationship).
  const providerConnected = await prisma.provider.create({
    data: {
      legalName: "General Hospital",
      normalizedName: "general hospital",
      mode: "client_connected",
      country: "RS",
      officialRegistrationNumber: "REG-0002",
      createdByClientAdminId: clientAdminA.id,
    },
  });
  await prisma.providerClientRelationship.create({
    data: {
      providerId: providerConnected.id,
      clientId: clientA.id,
      status: "active",
      activatedAt: new Date(),
    },
  });
  await prisma.user.create({
    data: {
      email: "provider.connected@medconnect.test",
      role: "provider_user",
      status: "active",
      passwordHash,
      firstName: "Petra",
      lastName: "Connected",
      providerId: providerConnected.id,
      createdByUserId: clientAdminA.id,
    },
  });

  // Provider 3: standalone with a PENDING relationship request to Client B
  // (tests the connect flow and "pending grants nothing yet" visibility rules).
  const providerPending = await prisma.provider.create({
    data: {
      legalName: "Regional Lab",
      normalizedName: "regional lab",
      mode: "standalone",
      country: "RS",
      officialRegistrationNumber: "REG-0003",
      createdBySuperAdminId: superAdmin.id,
    },
  });
  await prisma.providerClientRelationship.create({
    data: { providerId: providerPending.id, clientId: clientB.id, status: "pending" },
  });
  await prisma.user.create({
    data: {
      email: "provider.pending@medconnect.test",
      role: "provider_user",
      status: "active",
      passwordHash,
      firstName: "Petar",
      lastName: "Pending",
      providerId: providerPending.id,
      createdByUserId: superAdmin.id,
    },
  });

  // A suspended relationship, to exercise isolation-from-other-relationships tests.
  await prisma.providerClientRelationship.create({
    data: {
      providerId: providerConnected.id,
      clientId: clientB.id,
      status: "suspended",
      activatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      suspendedAt: new Date(),
    },
  });

  // One of each non-active account status, for permission-matrix coverage.
  const invitedUser = await prisma.user.create({
    data: {
      email: "invited@medconnect.test",
      role: "provider_user",
      status: "invited",
      firstName: "Ivana",
      lastName: "Invited",
      providerId: providerStandalone.id,
      createdByUserId: superAdmin.id,
    },
  });
  await prisma.invitation.create({
    data: {
      userId: invitedUser.id,
      status: "pending",
      tempPasswordHash: await bcrypt.hash("TempPass123!", 12),
      tempPasswordExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 72),
      invitedByUserId: superAdmin.id,
    },
  });

  await prisma.user.create({
    data: {
      email: "suspended@medconnect.test",
      role: "provider_user",
      status: "suspended",
      passwordHash,
      firstName: "Sonja",
      lastName: "Suspended",
      providerId: providerStandalone.id,
      createdByUserId: superAdmin.id,
      suspendedAt: new Date(),
    },
  });

  await prisma.user.create({
    data: {
      email: "deactivated@medconnect.test",
      role: "provider_user",
      status: "deactivated",
      passwordHash,
      firstName: "Dejan",
      lastName: "Deactivated",
      providerId: providerStandalone.id,
      createdByUserId: superAdmin.id,
      deactivatedAt: new Date(),
    },
  });

  // --- Segment 3 realistic scenario: Dunav Osiguranje TA policy + CORIS
  // Assistance's mandatory invoice elements, mixed into one Client-owned
  // Validation Scheme — exercises the global+Client-owned rule mixing the
  // whole segment is built around, using real-world exclusion clauses and
  // invoice requirements provided for testing.
  const coris = await prisma.client.create({
    data: { legalName: "CORIS Assistance d.o.o.", capabilities: ["assistance_company"] },
  });
  const clientAdminCoris = await prisma.user.create({
    data: {
      email: "admin.coris@medconnect.test",
      role: "client_admin",
      status: "active",
      passwordHash,
      firstName: "Cora",
      lastName: "ClientAdmin",
      clientId: coris.id,
      createdByUserId: superAdmin.id,
    },
  });

  const superAdminAuth: AuthContext = {
    userId: superAdmin.id,
    role: "super_admin",
    providerId: null,
    clientId: null,
    accountStatus: "active",
  };
  const corisAdminAuth: AuthContext = {
    userId: clientAdminCoris.id,
    role: "client_admin",
    providerId: null,
    clientId: coris.id,
    accountStatus: "active",
  };

  // 12 global exclusion clauses from Dunav's TA policy. Narrative clauses
  // that genuinely require reading medical context to apply — ai_assisted is
  // the correct execution type even though no evaluator runs against them
  // yet this phase (Segment 6/7's job); they are stored as inert config.
  const taExclusionClauses: { name: string; evaluationQuestion: string }[] = [
    {
      name: "TA Exclusion — Sunburn from Excessive Sun Exposure (Age Over 15)",
      evaluationQuestion:
        "Is the claim for sunburn caused by excessive exposure to the sun, where the insured person is older than 15 years of age?",
    },
    {
      name: "TA Exclusion — Chronic or Pre-Existing Disease at Policy Inception",
      evaluationQuestion:
        "Was the condition a chronic disease or a disease that already existed at the moment the insurance policy came into effect?",
    },
    {
      name: "TA Exclusion — Disease or Injury Treated in the 6 Months Before Inception",
      evaluationQuestion:
        "Was the disease or injury already being treated at any point in the 6 months immediately preceding the policy's inception date?",
    },
    {
      name: "TA Exclusion — Ongoing Treatment Exceeding Reasonable and Customary Expense",
      evaluationQuestion:
        "Does the claim involve an already ongoing required treatment or medicine whose cost exceeds a reasonable and customary expense for that treatment?",
    },
    {
      name: "TA Exclusion — Negligence or Irresponsibility of Insured or Guardian",
      evaluationQuestion:
        "Did the injury result from negligence or irresponsible behavior of the insured (or their guardian, if the insured is a minor) — for example sunburn, an Aqua Park injury, an extreme sport, or a suicide attempt, alcohol or drug abuse?",
    },
    {
      name: "TA Exclusion — Sports Risks Without Additional Premium",
      evaluationQuestion:
        "Did the claim arise from a sports risk activity that was not separately contracted with an additional premium?",
    },
    {
      name: "TA Exclusion — Psychoanalytical or Psychotherapeutic Treatment",
      evaluationQuestion: "Is the claim for psychoanalytical or psychotherapeutic treatment?",
    },
    {
      name: "TA Exclusion — Pregnancy or Childbirth Complications",
      evaluationQuestion:
        "Is the claim for pregnancy or childbirth, other than a life-threatening complication where the mother is under 38 years old and less than 30 weeks pregnant?",
    },
    {
      name: "TA Exclusion — Pregnancy Monitoring or Termination",
      evaluationQuestion: "Is the claim for routine pregnancy monitoring or for termination of a pregnancy?",
    },
    {
      name: "TA Exclusion — Rehabilitation or Physiotherapy",
      evaluationQuestion: "Is the claim for rehabilitation or physiotherapy treatment?",
    },
    {
      name: "TA Exclusion — Sexually Transmitted Diseases",
      evaluationQuestion: "Is the claim for a sexually transmitted disease?",
    },
    {
      name: "TA Exclusion — Dental Treatment Cap (EUR 150)",
      evaluationQuestion:
        "Is this a dental claim, and if so does it cover only emergency relief of acute toothache (the only dental treatment covered, capped at EUR 150)?",
    },
  ];

  for (const clause of taExclusionClauses) {
    const created = await prisma.$transaction((tx) =>
      createDraftRuleService(tx, superAdminAuth, {
        scope: "global",
        name: clause.name,
        category: "eligibility",
        executionType: "ai_assisted",
        definition: {
          evaluationQuestion: clause.evaluationQuestion,
          evidenceRequirements: ["medical_report"],
          applicabilityGate: { requiredDocumentTypes: [], requiredFields: [], triggeringValues: {}, skipConditions: [] },
          outputSchema: "AiRuleOutput",
        },
        applicability: { insurerId: dunav.id, productLine: "TA", countryCodes: ["RS"] },
        providerMessageCode: "ta_exclusion_review",
        adminMessageCode: "ta_exclusion_review",
        severity: "blocking",
        hitlPolicy: "on_needs_review",
      })
    );
    await prisma.$transaction((tx) =>
      publishRuleVersionService(tx, superAdminAuth, created.rule.id, created.rule.currentVersionId!, created.rule.version)
    );
  }
  const publishedTaRules = await prisma.validationRule.findMany({
    where: { scope: "global", category: "eligibility", name: { in: taExclusionClauses.map((c) => c.name) } },
    include: { currentVersion: true },
  });

  // 7 mandatory invoice elements CORIS requires — Client-owned, deterministic
  // field-presence checks. "Date and number of the invoice" is one listed
  // element covering two sub-facts; the deterministic required_field
  // operation only checks a single field, so this rule checks the invoice
  // number as the representative field (a simplification, documented here).
  const corisInvoiceFields: { name: string; fieldPath: string }[] = [
    { name: "CORIS Invoice — Reference Number Required", fieldPath: "invoice.coris_reference_number" },
    { name: "CORIS Invoice — Patient Name and Surname Required", fieldPath: "invoice.patient_full_name" },
    { name: "CORIS Invoice — Diagnosis Required", fieldPath: "invoice.diagnosis" },
    { name: "CORIS Invoice — Date of Examination Required", fieldPath: "invoice.examination_date" },
    { name: "CORIS Invoice — Invoice Date and Number Required", fieldPath: "invoice.invoice_number" },
    { name: "CORIS Invoice — Provider Reference Number Required", fieldPath: "invoice.provider_reference_number" },
    { name: "CORIS Invoice — Total Cost Required", fieldPath: "invoice.total_cost" },
  ];

  for (const field of corisInvoiceFields) {
    // All 7 legitimately share category+executionType+operation (only the
    // field path differs) — exactly the "same operation, different
    // parameters" case the probable-match duplicate check is designed to
    // flag. Pre-confirmed here since this is a deliberate, reviewed set.
    const created = await prisma.$transaction((tx) =>
      createDraftRuleService(tx, corisAdminAuth, {
        scope: "client",
        name: field.name,
        category: "document_requirement",
        executionType: "deterministic",
        definition: { operation: "required_field", parameters: { fieldPath: field.fieldPath } },
        applicability: {},
        providerMessageCode: "coris_invoice_field_missing",
        adminMessageCode: "coris_invoice_field_missing",
        severity: "blocking",
        hitlPolicy: "never",
        confirmedNotDuplicateBy: clientAdminCoris.id,
      })
    );
    await prisma.$transaction((tx) =>
      publishRuleVersionService(tx, corisAdminAuth, created.rule.id, created.rule.currentVersionId!, created.rule.version)
    );
  }
  const publishedCorisRules = await prisma.validationRule.findMany({
    where: { scope: "client", clientId: coris.id, category: "document_requirement", name: { in: corisInvoiceFields.map((f) => f.name) } },
    include: { currentVersion: true },
  });

  // One Client-owned Scheme mixing all 12 global exclusion rules and all 7
  // CORIS invoice rules. The submission-process constraints (max 20 invoices
  // per email, one insurer per collective invoice, 15-day submission window
  // from GOP receipt) are operational/SLA notes, not per-Case document
  // checks — there's no Case field for "GOP received date" and no
  // batch/email-submission concept in this codebase, so they're captured
  // here as free text rather than forced into rule rows nothing would
  // correctly evaluate.
  let scheme = await prisma.$transaction((tx) =>
    createDraftSchemeService(tx, corisAdminAuth, {
      scope: "client",
      name: "Dunav TA — CORIS",
      description:
        "Dunav Osiguranje TA policy validation for CORIS Assistance d.o.o. Submission process (not enforced as per-Case rules): " +
        "after receiving the GOP, send only invoices without supporting documentation; maximum 20 invoices per email; " +
        "collective invoices accepted for one insurance company only, maximum 20 cases per invoice; invoices must be issued " +
        "and sent within 15 days of receiving the GOP, otherwise CORIS may refuse to accept the invoice.",
      insurerId: dunav.id,
      productLine: "TA",
      countryCodes: ["RS"],
    })
  );
  let executionOrder = 0;
  for (const rule of [...publishedTaRules, ...publishedCorisRules]) {
    scheme = await prisma.$transaction((tx) =>
      addRuleToSchemeService(tx, corisAdminAuth, scheme.id, scheme.currentVersionId!, scheme.version, {
        version: scheme.version,
        ruleVersionId: rule.currentVersionId!,
        executionOrder: executionOrder++,
        parameters: {},
        enabled: true,
        required: true,
      })
    );
  }
  // Segment 5: Document Types for this scheme, added before publishing so
  // the published version retains them per spec §3's historical-immutability
  // requirement.
  const documentTypes: {
    code: string;
    name: string;
    required: boolean;
    multipleAllowed: boolean;
    acceptedMimeTypes: string[];
    expectedFields: string[];
    classificationHints: { filenameKeywords: string[]; textKeywords: string[] };
  }[] = [
    {
      code: "medical_report",
      name: "Medical report",
      required: true,
      multipleAllowed: true,
      acceptedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
      expectedFields: [],
      classificationHints: {
        filenameKeywords: ["medical", "report", "nalaz", "izvestaj"],
        textKeywords: ["medical report", "diagnosis", "patient", "signs/symptoms"],
      },
    },
    {
      code: "invoice",
      name: "Invoice",
      required: true,
      multipleAllowed: true,
      acceptedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
      expectedFields: [
        "invoice.coris_reference_number",
        "invoice.patient_full_name",
        "invoice.diagnosis",
        "invoice.examination_date",
        "invoice.invoice_number",
        "invoice.provider_reference_number",
        "invoice.total_cost",
      ],
      classificationHints: {
        filenameKeywords: ["invoice", "faktura", "racun"],
        textKeywords: ["invoice", "faktura", "total amount", "ukupno"],
      },
    },
    {
      code: "referral",
      name: "Referral",
      required: false,
      multipleAllowed: true,
      acceptedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
      expectedFields: [],
      classificationHints: {
        filenameKeywords: ["referral", "uput", "uputnica"],
        textKeywords: ["referral", "uputnica", "referred to"],
      },
    },
    {
      code: "passport",
      name: "Passport",
      required: false,
      multipleAllowed: false,
      acceptedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
      expectedFields: [],
      classificationHints: {
        filenameKeywords: ["passport", "pasos"],
        textKeywords: ["passport", "pasos", "republic of"],
      },
    },
  ];
  for (const docType of documentTypes) {
    scheme = await prisma.$transaction((tx) =>
      addDocumentTypeToSchemeService(tx, corisAdminAuth, scheme.id, scheme.currentVersionId!, scheme.version, {
        version: scheme.version,
        code: docType.code,
        name: docType.name,
        acceptedMimeTypes: docType.acceptedMimeTypes,
        required: docType.required,
        multipleAllowed: docType.multipleAllowed,
        expectedFields: docType.expectedFields,
        classificationHints: docType.classificationHints,
        displayOrder: documentTypes.indexOf(docType),
      })
    );
  }

  // Segment 6: deterministic extraction hints for the invoice type's already
  // pinned expectedFields — the only Document Type with real structured
  // fields to extract this phase.
  const invoiceDocType = await prisma.documentTypeDefinition.findFirstOrThrow({
    where: { schemeVersionId: scheme.currentVersionId!, code: "invoice" },
  });
  const invoiceExtractionFields: {
    code: string;
    label: string;
    valueType: "identifier" | "string" | "date" | "money";
    extractionHints: string[];
  }[] = [
    {
      code: "coris_reference_number",
      label: "CORIS Reference Number",
      valueType: "identifier",
      extractionHints: ["CORIS Reference:\\s*([A-Za-z0-9-]+)"],
    },
    {
      code: "patient_full_name",
      label: "Patient Full Name",
      valueType: "string",
      extractionHints: ["Patient:\\s*([^\\n]+)"],
    },
    {
      code: "diagnosis",
      label: "Diagnosis",
      valueType: "string",
      extractionHints: ["Diagnosis:\\s*([^\\n]+)"],
    },
    {
      code: "examination_date",
      label: "Examination Date",
      valueType: "date",
      extractionHints: ["Examination Date:\\s*([0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{4})"],
    },
    {
      code: "invoice_number",
      label: "Invoice Number",
      valueType: "identifier",
      extractionHints: ["Invoice Number:\\s*([A-Za-z0-9/-]+)"],
    },
    {
      code: "provider_reference_number",
      label: "Provider Reference Number",
      valueType: "identifier",
      extractionHints: ["Provider Reference:\\s*([A-Za-z0-9-]+)"],
    },
    {
      code: "total_cost",
      label: "Total Cost",
      valueType: "money",
      extractionHints: ["Total(?: Cost)?:\\s*([0-9.,]+\\s*(?:EUR|RSD)?)"],
    },
  ];
  await prisma.extractionFieldDefinition.createMany({
    data: invoiceExtractionFields.map((field, i) => ({
      documentTypeId: invoiceDocType.id,
      code: field.code,
      label: field.label,
      valueType: field.valueType,
      required: true,
      extractionHints: field.extractionHints,
      displayOrder: i,
    })),
  });

  await prisma.$transaction((tx) =>
    publishSchemeVersionService(tx, corisAdminAuth, scheme.id, scheme.currentVersionId!, scheme.version)
  );

  console.log("Seed complete.");
  console.log(`  Super Admin:            super@medconnect.test / ${DEV_PASSWORD}`);
  console.log(`  Client Admin (A):       admin.a@medconnect.test / ${DEV_PASSWORD}`);
  console.log(`  Client Admin (B):       admin.b@medconnect.test / ${DEV_PASSWORD}`);
  console.log(`  Provider User (standalone): provider.standalone@medconnect.test / ${DEV_PASSWORD}`);
  console.log(`  Provider User (connected):  provider.connected@medconnect.test / ${DEV_PASSWORD}`);
  console.log(`  Provider User (pending):    provider.pending@medconnect.test / ${DEV_PASSWORD}`);
  console.log(`  Invited (not yet active):   invited@medconnect.test (temp password: TempPass123!)`);
  console.log(`  Suspended:                  suspended@medconnect.test`);
  console.log(`  Deactivated:                deactivated@medconnect.test`);
  console.log(`  Client Admin (CORIS):       admin.coris@medconnect.test / ${DEV_PASSWORD}`);
  console.log(`  Scheme "Dunav TA — CORIS":  12 global exclusion rules + 7 CORIS invoice rules + 4 Document Types, published`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
