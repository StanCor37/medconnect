# MedConnect

Segments 1–2 (auth, roles, Clients, Providers, Provider–Client relationships,
invitations, account lifecycle), Segment 4 (Case creation and ownership),
Segment 3's catalog-management half (Validation Rules and Schemes — CRUD,
versioning, ownership, duplicate detection, promotion), Segment 5's
foundation half (Document upload, versioning, storage, and authorization),
Segment 6's data model plus its deterministic pipeline (embedded PDF
text extraction, filename/content-keyword classification, regex-based field
extraction and normalization) **and real OCR via a native Tesseract binary**,
and Segment 7 (Validation Process and Results — the engine that actually runs
a Case's pinned Validation Scheme, deterministic rules before **real
Claude-API-backed AI-assisted rules**, computes a deterministic overall
result, and routes Client HITL review) of the spec in `Prompt/` are built.
(Segment 6's specialized/generative-model classification and extraction are
still deferred — see Segment 6's section below.) See
`Prompt/` for the full 12-segment product spec and
`C:\Users\stani\.claude\plans\melodic-conjuring-wand.md` for the
implementation plan each phase followed.

## Stack

- Next.js 16 (App Router, TypeScript), React 19
- PostgreSQL via Prisma 7 (driver-adapter model — `@prisma/adapter-pg`)
- Custom DB-backed sessions via `iron-session` (not NextAuth) — chosen so
  suspending/deactivating a user revokes access immediately, which a
  stateless JWT can't do without a blocklist.
- shadcn/ui + Tailwind
- `pdfjs-dist` (Mozilla's PDF.js, Node-compatible legacy build) for embedded
  PDF text extraction, plus `@napi-rs/canvas` (its own optional dependency,
  reused directly) to rasterize pages that need OCR — see Segment 6's
  section below for why a hand-rolled text extractor wasn't enough.
- A native Tesseract OCR binary, invoked via `node:child_process` for OCR —
  no external service, no Python. See Segment 6's section below for why a
  PaddleOCR-based Python microservice was tried first and abandoned, and why
  the initial in-process `tesseract.js` (WASM) replacement was itself later
  swapped for the real native binary.
- `@anthropic-ai/sdk` (real Claude API calls, forced tool-use for structured
  output) for Segment 7's AI-assisted Rule evaluation — see Segment 7's
  section below.

## Setup

1. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (a Neon or any
   Postgres 14+ connection string) and `SESSION_SECRET` (32+ random bytes).
2. Install the native Tesseract OCR binary — Windows:
   `winget install --id UB-Mannheim.TesseractOCR`; Linux:
   `apt install tesseract-ocr`; macOS: `brew install tesseract`.
   `src/lib/processing/ocrClient.ts` resolves it from `PATH`, falling back to
   Windows' default `C:\Program Files\Tesseract-OCR\tesseract.exe` install
   path, or set `TESSERACT_PATH` to point at a specific binary. On Windows,
   a fresh terminal (not one open before the install) is usually needed for
   `PATH` to pick it up — the fallback path exists precisely so a
   long-running `next dev` process started before the install still works.
3. Get an Anthropic API key at <https://console.anthropic.com/> and set
   `ANTHROPIC_API_KEY` in `.env` — required for Segment 7's AI-assisted Rule
   evaluation to actually call Claude; without it, `ai_assisted` rules
   degrade gracefully to a `processing_error` result (never a false `fail`)
   rather than failing to start a validation run at all. Optional overrides:
   `ANTHROPIC_MODEL` (default `claude-sonnet-5`), `AI_RULE_CALL_BUDGET`
   (default `5`), `AI_LOW_CONFIDENCE_HITL_THRESHOLD` (default `0.6`).
4. `npm install`
5. `npx prisma generate`
6. `npx prisma migrate deploy` (applies `prisma/migrations/*`; the init
   migration has the foundation RLS policies appended directly — see
   `prisma/rls.sql` for the maintained source of the policy SQL, including
   Segment 7's, which was applied directly to both the dev and test
   databases rather than re-appended into an already-applied migration file
   — see Segment 7's section below for why).
7. `npx tsx prisma/seed.ts` — creates a fixture set: 1 Super Admin, 2 Clients,
   3 Providers across standalone/connected/pending states, one account of
   each status (invited/active/suspended/deactivated), and a realistic
   Segment 3/5/6 scenario — Client "CORIS Assistance d.o.o.", 12 global
   `ai_assisted` Validation Rules (Dunav Osiguranje's real TA-policy exclusion
   clauses), 7 Client-owned `deterministic` Rules (CORIS's mandatory invoice
   elements), 4 Document Types (`medical_report`, `invoice`, `referral`,
   `passport`) each with real `classificationHints`, 7
   `ExtractionFieldDefinition` rows on `invoice` with deterministic regex
   extraction hints, and one published Scheme ("Dunav TA — CORIS") mixing all
   of it. Credentials are printed to the console when the script runs.
8. `npm run dev`
9. `npm test` — runs the automated suite (see "Known limitations" below for
   how it's isolated from your dev/seed data).

## Known limitations / pre-production TODOs

- **RLS is written but not yet independently enforced.** The app currently
  connects to Postgres with a single owner-level `DATABASE_URL`, and Postgres
  table ownership bypasses Row-Level Security by default. The policies in
  `prisma/rls.sql` are real and will be exercised by a dedicated non-owner
  test role once that's introduced, but today the actual authorization
  boundary is the application layer: every list query goes through
  `scopedProviderWhere`/`scopedClientWhere`/`scopedRelationshipWhere`/
  `scopedUserWhere`/`scopedCaseWhere`/`scopedRuleWhere`/`scopedSchemeWhere`/
  `scopedDocumentWhere` (Case in `src/lib/cases/scoping.ts`, Rule/Scheme in
  `src/lib/rules/scoping.ts`, Document in `src/lib/documents/scoping.ts`
  (mirrors `scopedCaseWhere` exactly — "Document authorization inherits from
  the Case", spec Segment 5 §25), the rest in
  `src/lib/organizations/scoping.ts`), and every single-resource
  fetch combines the requested id with the same scoped `where` clause rather
  than trusting RLS to have filtered it. Case is the one table where Super
  Admin gets **zero** policy at all (not even the standalone-only carve-out
  every other table gives it) — enforced redundantly in three places:
  `scopedCaseWhere`'s always-impossible sentinel, `can()`'s unconditional
  first-line denial on every Case action, and the absent RLS policy itself.
  **Before
  production**, create a restricted `medconnect_app` Postgres role (no table
  ownership), grant it explicit SELECT/INSERT/UPDATE/DELETE, and point the
  app's runtime `DATABASE_URL` at it while migrations continue to run as the
  owner. This makes RLS a genuine second, independent enforcement layer
  instead of just written-but-dormant SQL.
- **The automated test suite runs against a dedicated Neon branch**
  (`TEST_DATABASE_URL` in `.env`), created as a schema-only branch off
  production — same tables, constraints, and RLS policies, zero data. It's
  completely isolated from your dev database: `npm test` can never see or
  touch the seeded fixtures from `prisma/seed.ts`. On top of that isolation,
  `tests/setup/fixtures.ts` still creates a randomly-suffixed fixture set per
  run (e.g. `admin-a-x7f2q1@test.medconnect.invalid`) and each test file
  deletes exactly what it created afterward — belt-and-suspenders, so the
  branch stays clean even without ever needing a full reset.
  - When the schema changes, apply the new migration to the test branch too:
    `npx prisma migrate deploy --config prisma.test.config.ts` (a second
    config file pointing at `TEST_DATABASE_URL` — `migrate deploy` has no
    `--url` flag, only `--config`). Note: a Neon "schema only" branch clones
    DDL but not row data, which includes Prisma's own `_prisma_migrations`
    bookkeeping table — the branch was created already caught up to the
    existing migration, so its history had to be reconciled once with
    `npx prisma migrate resolve --applied <migration_name> --config prisma.test.config.ts`
    rather than `migrate deploy` (which would have tried to re-run DDL that
    already physically exists on the branch and failed on "already exists").
    Future *new* migrations apply normally with `migrate deploy`.
  - `tests/lib/can.test.ts` — the `can()` policy matrix, pure/no DB, including
    the Segment 3 `rule.*`/`scheme.*` mutation ownership boundary (Super Admin
    sees-but-cannot-edit a Client-owned row with 403, Client Admin gets 404
    across Clients) and `case.assignScheme` (96 tests).
  - `tests/lib/scoping.test.ts` — the `scopedXWhere` functions against real
    Postgres, which are the actual authorization boundary right now (15 tests).
  - `tests/lib/organizations-service.test.ts`,
    `tests/lib/accounts-service.test.ts` — relationship lifecycle, duplicate
    detection, invite/suspend/delete lifecycle, including regression tests
    for the stale-update-return bugs found during manual testing (15 tests).
  - `tests/lib/cases-scoping.test.ts`, `tests/lib/cases-service.test.ts` —
    Case visibility (including Super-Admin-zero-visibility and
    `provider_case_access: creator_only` colleague exclusion), duplicate
    detection (including the standalone-vs-standalone case the DB unique
    constraint's NULL-distinctness can't catch on its own), idempotency
    replay/conflict, and the full create/update/share/assign/archive/restore/
    delete lifecycle with optimistic concurrency (25 tests).
  - `tests/lib/evaluateDeterministicRule.test.ts` — the 9 v1 deterministic
    operations (one pass/fail/skipped case each), normalization edge cases,
    and a literal source-scan proving the evaluator has zero network/SDK
    imports (spec §26.9) (14 tests).
  - `tests/lib/rules-scoping.test.ts` — `scopedRuleWhere`/`scopedSchemeWhere`
    visibility matrix: global-published visible to everyone, Super Admin's
    governance view into Client-owned drafts, Client Admin's own-Client
    any-status visibility, and the connected-Provider-sees-published-only
    boundary (7 tests).
  - `tests/lib/rules-service.test.ts` — ownership-forcing (a Client Admin
    cannot lie their way to `scope: global`), exact/probable duplicate
    detection with override, the publish/create-next-draft-version/archive
    lifecycle with optimistic concurrency, promotion (independent id, source
    left byte-for-byte unchanged, never auto-published), and a regression
    proving a next-draft version can actually be edited (and only a
    version belonging to the same Rule) before publishing it (11 tests).
  - `tests/lib/schemes-service.test.ts` — the cross-tenant-leak guard
    (`addRuleToSchemeService` rejects another Client's rule on a Client
    scheme and any Client rule on a global scheme), `assignSchemeVersionService`
    compatibility rules for standalone vs. Client-connected Cases with the
    `case_scheme_assigned` → `case_scheme_changed` audit transition, the
    archived-but-pinned-still-resolves guarantee, (Segment 5) Document Type
    CRUD draft-only editability plus `createNextDraftSchemeVersionService`'s
    Document Type deep-copy, and the same next-draft-is-actually-editable
    regression as the Rule side (8 tests).
  - `tests/lib/fileSignature.test.ts` — magic-byte sniffing for all 6
    supported formats, a lying extension/MIME rejected by content alone, and
    the PDF page-counter's primary path plus its documented approximation
    limit (11 tests).
  - `tests/lib/documents-scoping.test.ts` — `scopedDocumentWhere` matrix:
    Super Admin sees **zero** Documents even for a Client-shared Case,
    `provider_case_access: creator_only` colleague exclusion inherited from
    the parent Case, and a pending (not yet active) Provider–Client
    relationship granting zero Document visibility to a Client Admin (7 tests).
  - `tests/lib/documentTypes.test.ts` — Document Types are Scheme-configurable:
    a Scheme-pinned Case only accepts its own Scheme version's codes, a
    no-Scheme Case only accepts the hardcoded general list, `other_document`
    is always available without ever being seeded, and codes don't leak
    between the two lists (4 tests).
  - `tests/lib/documents-service.test.ts` — only a Provider User can upload
    (wrong-Provider and non-creator-on-`creator_only` both rejected), magic-byte
    validation wins over a lying filename, size-limit and
    password-protected/corrupted-PDF pre-storage rejection, one bad file in a
    batch not failing the rest, exact-duplicate detection scoped strictly to
    one Case, the type-confirmation → `document_type_confirmed`/
    `document_type_changed` audit transition, replace leaving the prior
    version byte-for-byte untouched, hard-delete-removes-stored-bytes vs.
    archive-once-real-activity-exists, and `DocumentPageReference` provenance
    for a multi-page PDF (12 tests).
  - **Not yet covered**: RLS policies themselves can't be meaningfully tested
    until the non-owner `medconnect_app` role exists (see above) — testing
    them today against the owner connection would trivially pass regardless
    of whether the SQL is even correct. Add `tests/rls/policy.test.ts`
    (connecting as the restricted role, per the original plan) once that role
    is created.
- **Email is a console-only dev stub** (`EMAIL_PROVIDER=console`, the
  default). Invitations and resends log to the server console instead of
  sending real email; the API also echoes `devTempPassword` in the JSON
  response while this is the active provider. Wire up a real
  `EmailProvider` (e.g. Resend) before this goes anywhere near real users —
  and remove the `devTempPassword` echo when you do.
- **No MFA.** Explicitly out of scope for this phase per the plan; Segment 2
  calls for it as a platform-policy option, not yet built.
- **Document storage is local disk, unencrypted at rest.** `src/lib/storage/`
  defines a `StorageAdapter` interface with one implementation,
  `LocalFilesystemStorageAdapter`, rooted at `DOCUMENT_STORAGE_ROOT` (defaults
  to `./storage/documents`, gitignored). Bytes are never exposed via a
  public/static path — they only ever flow through an authenticated download
  Route Handler that rechecks `scopedDocumentWhere`/`can()` on every request —
  but they are plain, unencrypted files on disk. **Before production**, add a
  cloud `StorageAdapter` (S3/Blob) behind the same interface and enable
  encryption at rest; no service-layer code should need to change. Related:
  `withAuth` wraps an entire upload request in one Postgres transaction
  (`withRls`), so today's local-disk `put`/`delete` calls run inside that open
  transaction — fine for fast local I/O, but a future cloud adapter should
  decouple file I/O from the DB transaction rather than holding it open across
  a network call.
- **No malware scanning, AI classification, or split detection** (OCR now
  exists — see below). `src/lib/documents/malwareScanner.ts` is a
  `NoOpMalwareScanner` stub (`malwareScanStatus` is always `"skipped"`),
  matching the console `EmailProvider` precedent above. Real AV integration,
  AI-model (specialized/generative) classification, and multi-document split
  detection remain unbuilt — see "What has NOT been built yet" below.
- **UI is placeholder-thin.** Login and set-password are fully functional;
  the three role "home" pages just confirm who's signed in. The actual
  Segment 12 navigation/dashboards aren't built yet.

## What has NOT been built yet

**Validation Rule and Scheme execution now exists** (Segment 7 — see its own
section below for the full picture: the engine, real Claude-backed
AI-assisted rules, HITL, and what's deliberately deferred within it). Still
genuinely out of scope: the full Case status lifecycle (Segment 8 — this
phase only ever transitions `draft ↔ archived`; Segment 7 never writes
`Case.status`, by design), Notifications (Segment 10), and Admin analytics
(Segment 9). Segments 3, 5, and 6 are each only partially built, for the same
reason as before: the catalog/data-model portion of each (spec §1–11 for
Segment 3; data model, storage, authorization, and versioning for Segment 5)
is done, but Segment 6's AI-based classification/extraction (as opposed to
Segment 7's AI-based *rule evaluation*, which is built) still doesn't exist.

**Segment 6 now has a real deterministic pipeline, wired into upload,
replace, and confirm-type** (`src/lib/processing/` — `pdfText.ts`,
`classification.ts`, `extraction.ts`, `normalize.ts`, `pipeline.ts`,
`job.ts`): embedded PDF text extraction via `pdfjs-dist` (a hand-rolled
regex/zlib extractor was tried first and tested against real sample
documents — it recovered zero usable text even from genuinely digital PDFs,
since ordinary subset-font/CID encoding needs a real `ToUnicode` CMap to
decode; `pdfjs-dist` resolves this correctly), filename/content-keyword
classification against `DocumentTypeDefinition.classificationHints`
(`{ filenameKeywords?, textKeywords? }`), and regex-based deterministic
field extraction against `ExtractionFieldDefinition.extractionHints`
(ordered regex sources, first capturing-group match wins), normalized via
the same date/money/name helpers `evaluateDeterministicRule.ts` already
proved out.

**OCR is now built too**, via a native Tesseract binary
(`src/lib/processing/ocrClient.ts`, `renderPdfPage.ts`) — for any page with
no embedded text (a scanned PDF page gets rasterized via `pdfjs-dist` +
`@napi-rs/canvas` first; a non-PDF image upload is passed straight through),
Tesseract recognizes real text and the result is merged into the *same*
`OcrPageResult` row the embedded-text step already created, so
classification/extraction consume it identically either way. A PaddleOCR-based
Python microservice was tried first — it required installing Python, a venv,
and pip-installing paddlepaddle/paddleocr, and even then hit a real
incompatibility (the latest paddleocr's PP-OCRv6/PaddleX pipeline throws an
unimplemented oneDNN/PIR error on Windows CPU inference; downgrading to an
older paddleocr/paddlepaddle pairing then hit a numpy ABI mismatch with the
rest of that toolchain). `tesseract.js` (a WASM port, running entirely
in-process) replaced it next — no Python, no separate service — but its WASM
build turned out to be both markedly slower and less reliable at actually
recognizing text than the real engine on the same images. The current
implementation shells out to the native Tesseract binary via
`node:child_process` per page instead: still no Python, no persistent
service, no network call — just a local CLI invocation using Leptonica's
native (non-WASM) image decoding and OpenMP-accelerated recognition, which is
both faster and more accurate than the WASM build. See the Setup section
above for installing the binary; `TESSERACT_PATH` overrides the resolved
path if it isn't on `PATH`.

**The Provider UI now surfaces classification suggestions and extracted
fields** (`src/components/provider/document-details.tsx`, plus
`src/lib/documents/extractedFieldsService.ts` and the
`/api/documents/[documentId]/classification` and `.../extracted-fields`
routes) — expanding a Document's "Details" shows the suggested type with a
one-click confirm, or the manual picker with spec §7's copy when
classification came back unclear; once a type is confirmed, a table lists
every configured field with Confirm / Correct / Not-present actions.
"Correct" reuses `normalizeExtractedValue` (the same normalizer the
pipeline itself uses) and rejects unparseable input with a 422 rather than
saving something wrong. "Cannot read" (spec §17's 4th action) was left out —
it has no pre-reserved audit event, unlike the other three, and the system
already sets `"unreadable"` automatically when there's no source text to
read at all.

**Known bug, not yet root-caused**: `pdfjs-dist`'s embedded text extraction
works correctly under plain Node (proven by `tests/lib/processing/*.test.ts`,
which run via Vitest/tsx, and by direct `tsx` scripts against real sample
PDFs) but currently returns **empty text for every PDF** when the exact same
code runs inside the actual Next.js dev server — confirmed with both
Turbopack and webpack, so it isn't bundler-specific. `pdf.numPages` parses
correctly (the file structure is read fine); `page.getTextContent()` itself
comes back with an empty `items` array, with no thrown exception. Getting
pdfjs-dist's fake-worker wired up at all took three iterations (see
`pdfText.ts`'s own comment for the failed attempts —
`createRequire(...).resolve(...)` and `import.meta.resolve(...)` each broke
differently under Turbopack specifically; statically importing
`pdf.worker.mjs` and publishing it via `globalThis.pdfjsWorker` fixed
*those* crashes) but this last symptom persists across bundlers, so the
remaining cause is more likely something about pdfjs-dist's in-process
LoopbackPort message-passing interacting with Next's own server runtime,
not the bundler layer this project already worked around. **Practical
effect**: PDF uploads currently get no embedded text in the running app (so
classification/extraction only ever reach them via the OCR fallback, which
does work — confirmed independently, since it doesn't depend on pdfjs-dist's
worker); non-PDF image uploads are unaffected (Tesseract runs directly on
the image bytes, no pdfjs-dist involved). Verified against 12 real
Dunav/CORIS-style sample documents during development — before this bug was
found — that about half had a genuine text layer and extracted correctly via
the deterministic path; the other half (scans, a vector-outlined invoice)
correctly produced no embedded text, which is now indistinguishable in
practice from every PDF hitting this bug until it's fixed.

Still explicitly **not built**: specialized/generative-model classification
and extraction (for variable layouts and templates OCR + regex can't
confidently parse — spec's own division of labor between deterministic and
AI methods), configurable confidence thresholds (a hardcoded `0.6`
auto-suggest cutoff instead), and job-queue async execution (the whole
pipeline, OCR included, runs synchronously inside the same transaction as
upload/confirm — noticeably more so now that OCR adds real latency;
`DocumentProcessingJob` rows track status/idempotency but nothing dequeues
them).

Rule/Scheme *execution* is built now (Segment 7 — see its own section
below). `evaluateDeterministicRule` (`src/lib/rules/evaluateDeterministicRule.ts`,
built in Segment 3 as a standalone, fully-testable, side-effect-free piece
ahead of any real caller) is what Segment 7's deterministic phase actually
calls against real Case data — proving out that "build the pure function
before its execution engine exists" pattern the same way the magic-byte/
page-count/readability checks in `src/lib/documents/` (Segment 5) and
`src/lib/processing/` (Segment 6's deterministic half) did before them.
Segment 5 also does not build: a real preview/
thumbnail generation for the viewer (needs HEIC/TIFF→web conversion, no
`sharp` installed — Segment 12 owns the actual viewer UI anyway), multi-document
splitting of one scan into several logical Documents (schema-ready via
`DocumentPageReference`, but nothing populates an actual split — one
`SourceFile` always produces exactly one `Document` this phase), per-Case
configurable upload limits (needs an admin-config surface — Segment 9), or
the Client document-request workflow (spec §23 — needs a "Provider task"
concept that doesn't exist).
`src/app/api/{notifications,analytics}/` plus the matching `src/lib/`
folders exist but are empty (Segments 9/10 — see Segment 7's own "Deferred"
list below for what its own spec sections left out for the same reason).

**Fixed bug (previously tracked as a follow-up task)**: after starting a new
draft version of a published Rule or Scheme
(`createNextDraftVersionService`/`createNextDraftSchemeVersionService`),
there used to be no way to actually edit that draft —
`updateDraftVersionService`, `addRuleToSchemeService`,
`addDocumentTypeToSchemeService`, and their sibling update/remove functions
all resolved "the draft to edit" via the parent's `currentVersionId`, which
deliberately still points at the OLD published version until the new one is
explicitly published. Discovered while writing Segment 5's seed-data
backfill (which needed to add Document Types to a fresh draft scheme
version); worked around there at the time with a direct
`prisma.documentTypeDefinition.create()` call rather than the service
function. Now fixed properly: every one of these functions takes the target
version id as an explicit parameter (`versionId` for Rules, `schemeVersionId`
for Schemes — the same pattern `publishRuleVersionService`/
`publishSchemeVersionService` already used) and verifies it actually belongs
to the parent and is still unpublished, instead of trusting
`currentVersionId`. Two regression tests
(`tests/lib/rules-service.test.ts`, `tests/lib/schemes-service.test.ts`)
exercise the full create-next-draft → edit → publish flow end to end,
including that a version id belonging to a *different* Rule/Scheme is still
correctly rejected. One related latent bug fixed alongside it:
`updateDraftVersionService` used to unconditionally mirror `patch.name` onto
the parent `Rule.name`, which — once the version-targeting fix made editing
a future (not-yet-current) draft possible — would have prematurely leaked
that unpublished draft's name into the Rule's live display name before it
was ever published; it now only mirrors the name when the edited version is
actually the current one.

## Segment 7 — Validation Process and Results (with real Claude AI-assisted rules)

The single biggest gap in the app before this phase: nothing anywhere
actually ran a Rule against a real Case. `evaluateDeterministicRule.ts` was a
pure, tested function with zero callers. This phase builds the real
execution engine (`src/lib/validation/engine/`), five new tables
(`ValidationRun`, `ValidationRuleResult`, `RequirementResult`, `HitlTask`,
`HitlDecision`), and — per explicit user direction to build this for real
rather than defer it — genuine Claude-API-backed evaluation for
`ai_assisted` Rules (`src/lib/ai/claudeAiRuleEvaluator.ts`), the first AI
integration anywhere in this codebase.

**Architectural tradeoff, stated up front**: like OCR, AI calls run
synchronously inside the same request/DB transaction as the rest of
validation — this project has no async job-dispatch precedent
(`DocumentProcessingJob` tracks idempotency, not queuing). A run can call
Claude up to `AI_RULE_CALL_BUDGET` (default 5) times, each with its own
20s timeout, so a transaction can stay open for tens of seconds in the
worst case. If this becomes a real bottleneck, `DocumentProcessingJob` is
the natural upgrade path; building async dispatch was out of scope here.

**The engine** (`resolvedInput.ts`, `requirements.ts`,
`applicabilityGate.ts`, `deterministicPhase.ts`, `aiPhase.ts`,
`overallResult.ts`, `recommendations.ts`, `service.ts`) implements spec §6's
12-step pipeline: builds a resolved-input snapshot from confirmed
Documents/ExtractedFields/Case fields (reusing `evaluateDeterministicRule`'s
own dot-path convention verbatim — `"documents.invoice"`,
`"fields.invoice.total_cost"`); evaluates Requirement completeness
separately from Rule outcomes (spec §7 "never use `fail` for missing
documents, absent fields"); runs deterministic Rules in `executionOrder`
before any `ai_assisted` Rule's applicability gate — a **pure, no-API-call**
check — decides whether Claude is even asked; computes the deterministic
`overall_validation_result` via a priority ladder that is its own concrete
design decision (the spec defines each value but not their relative
priority) and is directly unit-tested with zero DB involvement; creates a
`HitlTask` only for Client-connected Cases with an **active** relationship
(checked both at creation and, via `scopedHitlTaskWhere`, again at every
later access — a relationship that goes inactive after the task exists
makes it invisible/undecidable again, not just un-creatable).

**The `AiRuleOutput` contract** (`src/lib/validation/aiRuleOutput.ts`) is
deliberately tiny — `{outcome, confidence, evidence[]}`, no free-text
reasoning field at all — obtained via Anthropic's forced tool-use
(`tool_choice: {type: "tool", ...}`), never hoped-for JSON in a text
response. `reasonCode` on the stored result is derived server-side from
`outcome` alone, never trusted from the model; every `evidence[]` reference
is cross-checked against the Case's own real Document set and any
hallucinated id is dropped before persisting. No raw prompt or model text is
ever stored anywhere (spec §13/§29) — this is true by construction, not by
redaction after the fact.

**Revalidation and caching**: an explicit trigger (`provider_started`,
`provider_revalidated`, `client_requested_revalidation`) always creates a
new immutable `ValidationRun`, but a per-rule `inputSubsetHash` (hash of
only the field paths that specific rule's own definition/gate touches —
deliberately not a full `ValidationDependency` graph, see "Deferred" below)
is compared against the prior completed run's row for the same
`ruleVersionId` *before* the AI phase would call Claude — a genuine
skip-before-calling check, not a reuse-after-the-fact one, which is what
actually makes "never duplicate AI cost for identical inputs" true. A prior
run's rows are never mutated on supersession — only a `superseded` boolean
flips; `outcome`/`reasonCode`/`confidence` stay byte-identical forever
(spec §2 "preserve completed Validation Runs immutably").

**HITL decisions** (`src/lib/hitl/`) are a parallel `HitlDecision` row next
to the automated `ValidationRuleResult` they respond to — the automated
outcome column is never touched by a decision, satisfying spec §15/§19's
"automated and human outcomes remain separate" structurally. Every override
(`override_to_pass`/`override_to_fail`) requires a non-empty reason,
enforced twice (Zod at the route, and again inside the service itself as
defense-in-depth for any future direct caller). `HitlTask` gets the same
`version`-based optimistic concurrency every other mutable entity in this
codebase has, even though the spec's own type sketch omits it.

**New authorization**: `case.validate` (provider-only, reuses
`caseMutationPolicy`), `case.requestRevalidation` (Client Admin only),
`hitl.view`/`hitl.decide` (Client Admin must own the task's
`assignedClientId`; Provider gets read-only). `scopedHitlTaskWhere`
(`src/lib/hitl/scoping.ts`) mirrors `scopedCaseWhere` exactly, joined
through the parent Case.

**UI**: the Provider's Case detail page gets a "Validate"/"Revalidate"
button and a results panel grouped exactly per spec §12's 8 groups (never a
raw dump) — `src/components/validation-panel.tsx` (moved out of
`components/provider/` since Client Admin reuses the identical component via
a `variant="client"` prop that swaps the trigger to "Request Revalidation"
and posts to the Client-only endpoint instead). Client Admin also gets a
genuinely new, previously-empty `/admin/cases` area (list + **read-only**
detail — spec §17 grants view/HITL-decide/request-revalidation, never
upload/confirm-type/edit, which stay exclusively the Provider's) and
`/admin/hitl`, a decision inbox for the 5 `HitlDecisionType`s.

### Deferred within Segment 7 (with justification)

- **`ValidationDependency` / a real dependency graph (§21)** — replaced by
  the per-rule `inputSubsetHash` described above, which gives the same
  externally-observable "only affected rules rerun" behavior without a
  graph or a new rule-authoring UI for declaring dependencies.
- **`ValidationResultSnapshot` / PDF export (§23)** — no export/report
  feature exists anywhere in the app yet to consume it.
- **A literal `ValidationResultCacheKey` table (§25)** — the reuse behavior
  is implemented directly via `inputSubsetHash` + `ruleVersionId`
  comparison; a separate cache-key table would add nothing at this scale.
- **Notifications (§28) and usage/quality metrics (§30)** — Segments 10/9
  don't exist yet; nowhere to send a notification, no analytics surface to
  feed. The schema captures everything a future version of either would
  need without a further migration.
- **Full conflict detection (§20)** — needs Scheme-level rule precedence
  config that doesn't exist (`ValidationSchemeRule` has no priority field) —
  a Scheme-authoring feature (Segment 3), not engine work.
- **`automatic_after_upload`/`automatic_after_confirmation`/`system_retry`
  triggers** — enum values reserved (same "define the shape before the
  wiring exists" precedent as unused `CaseStatus` values), not yet called
  from `uploadDocumentsService`/`confirmDocumentTypeService`.
- **A per-Rule configurable confidence threshold** — implemented instead as
  one env var (`AI_LOW_CONFIDENCE_HITL_THRESHOLD`) applied uniformly; a
  per-`ValidationRuleVersion` column is a cheap, non-breaking follow-up.
- **`Case.status` is never written** — spec §27 explicitly assigns that
  mapping to a different segment (Segment 8).

### A real migration-tooling lesson learned mid-build

Manually appending Segment 7's RLS `CREATE POLICY` SQL directly into its own
already-*applied* migration file (to keep the per-migration history
self-contained, matching how Segments 5/6 embedded their own RLS alongside
their schema DDL) broke Prisma's own checksum verification on the next
`prisma migrate dev` call — it detected the file no longer byte-matched what
it had recorded as applied, and offered `migrate reset` (which would have
dropped the whole dev database) as the only interactive way forward. No data
was lost: the fix was reverting that file to its original applied content,
confirming via `prisma migrate status` that the actual database schema was
never out of sync (only the file's bookkeeping checksum was), then
correcting the stored checksum directly to match. Segment 7's RLS policies
are real and applied to both the dev and test databases (see `prisma/rls.sql`
for the source), just not re-embedded into that specific migration file
after the fact — a smaller, deliberate deviation from the established
per-migration-RLS-embedding convention, made once the risk of the
alternative became concrete rather than theoretical.

Also out of scope for this phase specifically (Segment 4 items explicitly
deferred per the spec's own guidance): Client-side Case creation (Client Admin
only views/reviews in v1), Client-to-Client reassignment (needs Segment 8's
submission-cancellation concept and Segment 5's per-document copy selection),
and a `cases:write` API-key/integration-auth scope (no API-key system exists
yet — idempotency is built for session-authenticated creation instead, scoped
per-Provider).

## Segments 1–2 — manually verified (live, against the seeded Neon database)

- Invite → console-logged temp password → set-password → login → session
  cookie issued.
- Suspending a user immediately revokes their session (next request gets
  401), not just blocks future logins.
- Super Admin sees only standalone Providers (both in list and single-item
  fetch) — a client-connected Provider is invisible even by direct ID.
- Client Admin sees a Provider only through an **active** relationship;
  pending and suspended relationships correctly grant no visibility, to
  either the Provider org or its Provider Users' accounts.
- Cross-tenant direct-ID access returns 404, not the other org's data
  (verified for Provider, Client, and User resources).
- A Client Admin cannot create a Provider User for a Provider they don't have
  an active relationship with (403), even knowing a valid `providerId`.
- Duplicate-provider detection blocks creation on an exact
  country+registration-number match (409).
- A standalone Provider accepting a pending Client connection request flips
  `Provider.mode` to `client_connected`; suspending/terminating one
  relationship doesn't touch a Provider's other Client relationships.
- Forged/browser-supplied `providerId`/`clientId` in a request body cannot
  escalate access — the server always derives identity from the session.

Three real bugs were caught and fixed during this manual pass, which is
exactly why Segment 1 insists on backend tests before trusting the API:
1. Two `can()` policy branches said "RLS enforces this" and unconditionally
   allowed — since RLS isn't independently active yet (see above), this let
   Super Admin see client-connected Providers in the list endpoint, and let a
   Client Admin/Provider User fetch an unrelated org by guessed ID. Fixed by
   making the scoped DB query (not a trust comment) the actual boundary.
2. The scoped `where` combination for single-item GETs used a naive object
   spread (`{ id: paramId, ...scopedWhere }`), which silently let
   `scopedWhere`'s own `id` field (present for the Provider User / Client
   Admin "self" cases) clobber the route's `id` filter. Fixed with an
   explicit `AND: [...]`.
3. `activateRelationshipService`, `changeRelationshipStatusService`, and
   `setAccountStatus` all returned the pre-update object fetched at the start
   of the function instead of the result of `.update(...)`, so API responses
   echoed stale status values even though the underlying write succeeded
   correctly.
4. `revokeAllSessionsForUser` used a module-level `prisma` client (always
   `DATABASE_URL`) instead of the transaction it was called within — broke
   atomicity with the status update/audit event it accompanies, and would
   have silently revoked sessions in the wrong database once tests started
   pointing at a separate branch. Fixed by threading `tx` through, matching
   every other service function.

## Segment 4 — manually verified (live, against the dev database)

- `POST /api/cases` generates a `MC-YYYY-NNNNNNN` internal reference and
  correctly rejects a Client with only a pending relationship (422).
- `share-with-client` correctly requires an active relationship (422 without
  one) and, once shared, the Case becomes visible to that Client Admin.
- **Super Admin gets 404 on every single Case route attempted directly by
  ID — including a Case that's Client-connected** (i.e. data a Client Admin
  or the owning Provider can see), not just standalone ones. This is the one
  resource type where Super Admin's carve-out is zero, not
  "standalone-only," and it held under direct manual testing.
- Idempotency: two creates with the same `Idempotency-Key` and body return
  the identical Case ID; a third with the same key and a different body is
  rejected with `idempotency_key_conflict` (409).
- Update, archive, restore all apply correctly with optimistic-concurrency
  version increments; an archived Case is excluded from the default list.

## Segment 3 (catalog management) — manually verified (live, against the dev database)

Walked through the realistic Dunav Osiguranje / CORIS Assistance scenario
from `prisma/seed.ts` end-to-end over the real API (not just the automated
suite): a CORIS-connected Provider User sees both the global scheme and
CORIS's own "Dunav TA — CORIS" scheme (`GET /api/schemes`), creates a
Client-connected Case, and successfully assigns the CORIS scheme to it. A
standalone Provider User's Case correctly gets `422 incompatible_scheme`
assigning that same Client-owned scheme, then succeeds assigning a
fully-global one. Super Admin can `GET` a CORIS-owned Rule for governance
(`200`) but gets `403 forbidden` attempting to archive it. Archiving the
CORIS scheme (as CORIS's own Client Admin — Super Admin gets `403` on a
Client-owned scheme, matching the Rule case) leaves the already-assigned
Case's pinned `validationSchemeVersionId` fully resolvable, while a *fresh*
assignment attempt against that now-archived-parent version correctly gets
`409 invalid_scheme_state` — proving "unavailable for new use, valid for
history" holds over real HTTP requests, not just inside a test transaction.

One real bug was caught and fixed before any of this shipped:

1. `updateSchemeRuleSchema` was initially derived via
   `addSchemeRuleSchema.omit({ ruleVersionId: true }).partial()`. Since the
   base schema's fields carry `.default(...)`, Zod's `.partial()` would have
   silently reapplied those defaults (e.g. `enabled: true`) whenever a field
   was simply omitted from a partial-update request body — incorrectly
   resetting an existing pairing's `enabled`/`required`/etc. on every
   partial `PATCH`. Caught during code review, before running any test.
   Fixed by writing an independent schema with plain `.optional()` fields
   and no defaults, so an omitted key genuinely means "leave unchanged."

Two schema-design gaps were caught before they ever reached working code
(during planning, cross-referenced against the spec text rather than found
by testing): the Plan agent's initial `HitlPolicy` enum only had 3 of the
spec's 4 values (missing `on_needs_review`, spec §20), and an initial
`ValidationRule.schemeRules` convenience relation field failed
`prisma validate` outright (a rule only relates to a specific
`ValidationRuleVersion`, never to `ValidationRule` directly) — both fixed
before migrating.

The only other issues hit this phase were **test-authoring bugs, not service
bugs**: two tests in `tests/lib/rules-service.test.ts` initially tried to
trigger duplicate detection against an unpublished draft rule, but the
duplicate search pool is deliberately published-global-only (spec §9) —
fixed by publishing the rule first. Several independent tests also shared
the exact same default rule shape, so once one test published its rule,
later ones started legitimately triggering the probable-match check against
it (the system working as designed, just a test-isolation flaw) — fixed by
giving each independent test's rule a distinct `category`. A related
lesson: two of those early failing runs left orphaned `ValidationRule` rows
in the Neon test branch (an unexpectedly-successful `createDraftRuleService`
call inside a `.rejects.toMatchObject(...)` assertion isn't reachable by the
test's own `createdRuleIds` tracking array), which in turn blocked
`fixtures.ts`'s `cleanup()` from deleting the fixture Users those orphans
referenced via `createdByUserId` (a `RESTRICT` FK) — manually cleaned up
once; the fix above (tests now only create rows on paths that are actually
tracked) prevents a recurrence.

## Segment 5 (Document upload foundation) — manually verified (live, against the dev database)

Walked through the full upload lifecycle over the real API against the
CORIS/Dunav scenario: the CORIS-connected Provider User creates a new
Client-connected Case, assigns it "Dunav TA — CORIS" (now on its second
published version, with the 4 Document Types added on top of its original 19
Rules), and sees the type selector return exactly `medical_report` /
`invoice` / `referral` / `passport` / `other_document`. Uploads a 3-page PDF
and a JPEG in one batch (`201`, both `status: "created"`); confirms `invoice`
on the JPEG (`200`, `status: "ready"`, audits `document_type_confirmed`);
re-uploads the identical JPEG bytes to the same Case and gets back
`status: "duplicate"` with the original `documentId`, no new row created;
replaces the PDF with a `clearer_copy` reason (`200`, new `currentVersionId`)
and confirms both versions remain listed via `GET .../versions`. CORIS's
Client Admin can `GET`/list/download both documents (`200`, correct
`Content-Type` on download) but gets `403 forbidden` attempting to upload or
replace. A standalone Provider User with no Scheme pinned gets the 4-item
general fallback list (`medical_report`/`invoice`/`referral`/`passport`) plus
`other_document`, and uploads successfully using one of those codes directly.
Super Admin gets `404` on every single Document route attempted directly by
ID — the list endpoint, a single Document, and its version history — for a
Case that Client Admin and the owning Provider can both see, matching Case's
own zero-visibility rule exactly.

No new service-layer bugs were found during this manual pass — the one real
issue caught during backfill was the pre-existing Segment 3 draft-editing bug
described above (out of scope, flagged separately), not anything in this
segment's own upload/versioning/authorization code.

## Segment 6 (deterministic pipeline) — manually verified (live, against the dev database, and against 12 real sample documents)

Before choosing an approach, a hand-rolled regex/zlib PDF-text extractor
(matching `countPdfPages`'s own house style) was tried first and tested
against two real sample documents: it recovered **zero** usable text from
either — one had no text layer at all (vector-outlined glyphs), but the
other's genuine text layer used subset-font CID/Identity-H encoding a regex
can't decode without resolving the font's `ToUnicode` CMap. Switched to
`pdfjs-dist` (added as a dependency) on that evidence, then re-tested against
12 real Dunav/CORIS-style documents (medical reports, invoices, referrals,
insurance policies, a passport): **6 of 12 had a genuine text layer and
extracted correctly** (structured invoices, guarantee-of-payment letters,
digitally-generated medical reports); **the other 6 — scanned policies, a
vector-outlined invoice, photographed forms — correctly produced no usable
text**, falling through to `"unreadable"`/`"pending"`/`"unclear"` rather than
silently failing or inventing a result. That's the expected OCR gap this
phase leaves open, not a bug.

Backfilled the dev DB's CORIS Document Types with real `classificationHints`
and added the 7 `ExtractionFieldDefinition` rows for `invoice` (mirroring
`prisma/seed.ts`'s new fixture data, non-destructively — a fresh
`prisma migrate reset && seed` would also produce this, this just avoided
wiping already-present dev/UI-testing data). Ran the actual
`uploadDocumentsService` → `confirmDocumentTypeService` chain against a real
downloaded invoice PDF ("MEDEX sa popustom.pdf", an AQA/Coris invoice with a
genuine text layer): upload correctly cached its embedded text (1063 chars)
and produced a `DocumentClassificationResult` — but classified it
**`"unclear"`** (top candidate `medical_report` at 0.33 confidence, `invoice`
at 0.25 — the invoice's own "art of medicine"/"medical" boilerplate text
scored higher against `medical_report`'s weak keyword set than against
`invoice`'s), correctly declining to auto-suggest below the 0.6 threshold
rather than forcing a guess. Manually confirming `invoice` ran extraction
immediately, but produced **zero** `ExtractedField` rows — this real
invoice's actual labels (`Invoice No:`, `Invoice Date:`, `PATIENT NAME :`,
`TOTAL   EUR   742`) don't match the seed's configured regex hints (tuned to
a different, synthetic label format). This is the correct, honest outcome
for label-based deterministic extraction against an unfamiliar template —
"never invent missing values" — not a bug; it's exactly the gap spec §10/§26
assigns to AI extraction for variable layouts, still deferred. The full
automated suite (`tests/lib/processing/*.test.ts` — `pdfText`,
`classification`, `extraction`, `pipeline` wiring — 17 tests) exercises the
same logic against synthetic fixtures built with genuine, valid PDF
structure (a real xref table, standard Helvetica text) rather than real
personal documents, since the real sample files contain identifying
information (names, passport numbers, a diagnosis) not appropriate to commit
into the repo's test fixtures.

## Segment 7 (validation engine + real Claude AI rules) — manually verified (live, against the dev database)

Assigned a real published global Scheme (containing one real seeded
`ai_assisted` Rule, "TA Exclusion — Sexually Transmitted Diseases") to a
standalone Case via `assign-scheme`, then clicked **Validate** in the actual
running Provider UI (not just a script). First attempt genuinely failed with
a live 500 — the long-running dev server process had been started before
this segment's migration and `prisma generate`, so its cached Prisma Client
had no idea `ValidationRun`/`HitlTask`/etc. existed (`Cannot read properties
of undefined (reading 'findMany')`) and the moved `validation-panel.tsx`
import was resolved from its pre-move path by a stale Turbopack module
graph. A full dev-server restart (no code change needed) fixed both —
exactly the "works in tests, breaks against the real long-running server"
risk this project has hit before (see Segment 6's pdfjs-worker story) and
the reason this workflow always includes a live check, not just automated
tests. After the restart: **Validate → 201 Created**, results panel
correctly showed **"Processing Failed"** with the AI rule listed under
"Technical issues" — because no real `ANTHROPIC_API_KEY` is configured on
this machine, the live Claude call genuinely failed
(`technicalErrorCode: "rule_engine_error"`), and the engine correctly
recorded that as a technical failure, never as a false rule `fail` — a live,
unscripted confirmation of spec §7/§24's "technical errors are not insurance
failures," using the real Anthropic SDK's real error path, not a fake.
Separately verified the new Client Admin surfaces: `/admin/cases` lists
shared Cases, `/admin/cases/[id]` renders the identical read-only Case
view with a **"Request Revalidation"** button (not "Validate" — the
`variant="client"` swap works), and `/admin/hitl` renders its empty state
correctly (no HITL task existed in this scenario, since the only Rule
exercised resolved to a technical error rather than `needs_review`/`fail`).

The full automated suite for this segment
(`tests/lib/validation/{overallResult,applicabilityGate,engine}.test.ts` —
35 tests: 2 pure/no-DB files proving the overall-result ladder and
applicability-gate logic in isolation, plus a DB-backed `engine.test.ts`
covering pinning, deterministic-before-AI ordering, missing-requirements-
never-become-rule-failures, a real `FakeAiRuleEvaluator`-driven technical-
failure case, standalone-never-creates-HITL, full revalidation/caching
behavior including a genuine before-the-call cache check, HITL decision
immutability and stale-version rejection, and cross-Client HITL isolation)
found a real test-isolation bug during development, not a production one:
several early drafts of these tests shared one Case fixture across tests,
so one test's cached `ValidationRuleResult` silently changed a later test's
expected outcome. Fixed by giving every test that isn't specifically about
revalidation its own dedicated Case — a good reminder that this engine's
caching is aggressive by design, so tests need explicit isolation the way
plain CRUD tests don't.
