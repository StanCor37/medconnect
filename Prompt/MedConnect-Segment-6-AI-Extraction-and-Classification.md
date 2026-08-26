# MedConnect — Segment 6: AI Extraction and Classification

## Purpose

Define how MedConnect reads uploaded documents, classifies logical Documents and extracts structured values required by the applicable Validation Scheme.

The pipeline must minimize AI use through embedded text, OCR, deterministic parsing, cached results and Provider confirmation.

Classification determines what a document is. Extraction determines which structured values it contains. Validation against rules is defined separately.

## 1. Core Principles

- Process logical Documents after scan splitting rather than treating a mixed scan as one document.
- Preserve every result’s source page and evidence location.
- Extract only fields required by the pinned Validation Scheme.
- Extract each field once per Document Version.
- Reuse extracted values across dependent rules.
- Prefer deterministic parsing and specialized OCR over generative AI.
- Use AI only when cheaper methods cannot decide reliably.
- Require Provider choice when classification remains unclear.
- Never invent missing values.
- Preserve conflicting candidates rather than choosing without evidence.
- Never overwrite original machine output after human correction.
- Do not send complete Cases or unrelated documents to a model.
- Require strict structured output.
- Track token usage and cost without PII.

## 2. Processing Pipeline

```text
Secure upload
  → readability check
  → logical document split
  → embedded text extraction
  → OCR only where needed
  → deterministic classification signals
  → AI classification only where needed
  → Provider type confirmation when unclear
  → identify required extraction fields
  → deterministic field extraction
  → specialized or small-model extraction where needed
  → normalize values
  → confidence and evidence checks
  → Provider review of unclear values
  → store confirmed structured values
  → trigger dependent validation rules
```

Do not trigger validation until required Document Types and required extracted fields reach an eligible state.

## 3. Processing Unit

Process an immutable `DocumentVersion`.

```ts
ProcessingInput {
  case_id
  document_id
  document_version_id
  source_file_id
  page_references
  scheme_version_id
  document_type_set_version
  extraction_schema_version
}
```

Never process “the latest document” without pinning a version.

If a newer version appears during processing, let the current job finish safely but keep its output attached to the older version. Never apply stale output to the new version.

## 4. Classification Model

```ts
classification_status:
  "pending" |
  "processing" |
  "suggested" |
  "confirmed" |
  "unclear" |
  "failed"
```

```ts
DocumentClassificationResult {
  id
  document_version_id
  suggested_type_code
  candidate_types
  confidence
  evidence_references
  method
  classifier_name
  classifier_version
  created_at
}
```

```ts
classification_method:
  "provider_selected" |
  "metadata" |
  "filename" |
  "deterministic_text" |
  "specialized_model" |
  "generative_ai"
```

## 5. Classification Order

Use this order:

1. Provider-selected type.
2. Embedded metadata.
3. Safe filename hints.
4. Deterministic text patterns.
5. Cached classification for an exact content hash and identical type set.
6. Specialized classification model.
7. Small generative model only if necessary.
8. Provider choice if confidence remains insufficient.

Do not call AI when the Provider already selected a valid type. Do not call AI again after confirmation unless the Document Version or available type configuration changes.

## 6. Classification Candidates and Thresholds

Preserve plausible candidates:

```ts
ClassificationCandidate {
  document_type_code
  confidence
  evidence_references
}
```

Do not force a definitive type when confidence is insufficient.

Thresholds are configurable and versioned:

```ts
ClassificationThresholds {
  auto_suggest_min
  provider_confirmation_required_below
  failed_below
}
```

- High confidence: preselect and allow confirmation or change.
- Medium confidence: show strongest candidates and require selection.
- Low confidence: show applicable types and require selection.
- Processing failure: allow manual selection without waiting for another model call.

Confidence must never automatically share, approve or reject a Case.

## 7. Classification UI

Suggested:

```text
We identified this as: Medical report
```

Actions: `Confirm` and `Change type`.

Unclear:

```text
We could not determine the document type. Choose the type that best matches this document.
```

Actions: `Choose document type` and `Other document`.

Failed:

```text
Automatic classification was unavailable. Choose the document type to continue.
```

Manual continuation must remain available when automation fails.

## 8. Extraction Schema

Fields come from the pinned Scheme and Document Type.

```ts
ExtractionFieldDefinition {
  id
  document_type_code
  label
  value_type
  required
  repeatable
  normalization
  extraction_hints
  validation_dependencies
  sensitive
}
```

Supported v1 types:

```ts
"string" |
"date" |
"number" |
"money" |
"boolean" |
"identifier" |
"code"
```

Extract only fields required by applicable rules, Case matching, configured output or an explicit authorized request. Do not extract everything merely because it appears in a document.

Possible configured fields include patient and insured-person identifiers, Provider data, medical-event dates, diagnosis, treatment, invoice details, policy dates and trip data. None is universally required.

## 9. Text Acquisition and OCR

Use this order:

1. Extract embedded PDF text.
2. Assess whether it is usable.
3. OCR only pages without reliable text.
4. Preserve page-level text and coordinates.
5. Detect language per page or block.
6. Preserve original text.
7. Create normalized text separately.

Do not OCR an entire PDF when embedded text is reliable. Do not send page images to a generative model when OCR text is sufficient.

```ts
OcrPageResult {
  document_version_id
  page_number
  text
  language
  confidence
  blocks
  ocr_engine
  ocr_engine_version
  created_at
}
```

```ts
OcrBlock {
  text
  confidence
  bounding_box
  block_type
}
```

OCR output is a machine result and never replaces the original document.

## 10. Extraction Methods

```ts
extraction_method:
  "embedded_text" |
  "deterministic_parser" |
  "ocr" |
  "specialized_model" |
  "generative_ai" |
  "provider_entered" |
  "client_reviewed"
```

Use deterministic methods for stable labelled dates, structured invoice totals, known policy-number formats, currency codes, registration numbers and exact identifiers.

Use generative AI only for variable layouts, ambiguous labels, complex tables, medical narrative, contextual distinctions and handwriting where supported and required.

## 11. Extracted Field Model

```ts
ExtractedField {
  id
  case_id
  document_id
  document_version_id
  field_definition_id
  raw_value
  normalized_value
  value_type
  status
  confidence
  extraction_method
  evidence_references
  extractor_name
  extractor_version
  confirmed_value
  confirmed_by_user_id
  confirmed_at
  created_at
}
```

```ts
extraction_status:
  "extracted" |
  "confirmed" |
  "corrected" |
  "absent" |
  "unreadable" |
  "low_confidence" |
  "inconsistent" |
  "invalid" |
  "failed"
```

Meanings:

- `absent`: expected value does not appear
- `unreadable`: possible source exists but cannot be read
- `low_confidence`: candidate exists but is uncertain
- `inconsistent`: conflicting candidates exist
- `invalid`: value cannot be normalized to the required type
- `failed`: processing could not complete

Never collapse them into one generic error.

## 12. Evidence Provenance

Every extracted value references its source:

```ts
EvidenceReference {
  document_version_id
  page_number
  bounding_box
  text_snippet
  source_block_id
}
```

Selecting a field in the UI must highlight supporting evidence in the viewer.

Evidence snippets are PII and must not enter logs, analytics or audit payloads.

## 13. Multiple Candidates and Conflicts

Preserve all candidates:

```ts
ExtractionCandidate {
  raw_value
  normalized_value
  confidence
  evidence_references
  method
}
```

Do not silently choose the first patient name, total, date or identifier.

Use source precedence only when explicitly configured:

```ts
FieldSourcePrecedence {
  field_id: "medical_event_date"
  sources: [
    "medical_report.examination_date",
    "invoice.service_date",
    "case.event_date"
  ]
}
```

If precedence cannot resolve the conflict, mark `inconsistent` and require Provider review or Client HITL where applicable.

## 14. Normalization

Store raw and normalized values separately.

- Names: trim, normalize Unicode and preserve original spelling. Create a comparison form separately.
- Dates: normalize to ISO and record ambiguity. Never guess day and month silently.
- Money: store integer minor units and ISO currency. Never use floating point.
- Identifiers: normalize by configured type and preserve meaningful leading zeros.
- Medical codes: preserve source text and extracted code separately. Never invent a code from narrative alone.

## 15. Languages and Translation

Detect language per page or block. Preserve original text, detected language and normalized value.

Do not translate complete documents by default. Translate only evidence passages required for rule interpretation and cache the translation.

Every translation references its original source and engine version.

## 16. Handwriting

Treat handwriting as a confidence risk.

If it cannot be read reliably, use `unreadable` or `low_confidence`.

Show:

```text
Some handwritten information could not be read reliably. Review the highlighted fields.
```

Never invent or autocomplete handwritten medical information.

## 17. Provider Review

Show fields needing attention before high-confidence fields.

For each field show label, extracted value, confidence state, source document and page, highlighted evidence, alternative candidates and confirm/edit actions.

Actions:

```text
Confirm
Correct
Not present
Cannot read
```

Corrections preserve the original machine value, corrected value, actor, timestamp and reason where required.

## 18. Client Review

For Client-connected Cases, Client Admin may confirm a Provider value, propose a correction, request Provider confirmation or request additional documentation during HITL.

Preserve machine, Provider-confirmed and Client-reviewed values separately with actors and timestamps.

Client Admin cannot access or review standalone Case extraction.

## 19. Required Fields

A field is required only when its Document Type is present and the Scheme marks it required.

If required data is absent, unreadable, invalid or unresolved:

- mark the requirement incomplete
- show the exact field requiring attention
- prevent only dependent validation rules
- preserve unrelated extraction and validation
- allow replacement or permitted manual correction

A missing field is not itself a failed insurance-rule decision.

## 20. Minimal AI Input

```ts
ExtractionRequest {
  document_type_code
  requested_fields
  relevant_pages_or_blocks
  field_definitions
  extraction_hints
  required_output_schema
}
```

Do not send complete Cases, unrelated documents, complete Schemes, unrelated rules, previous prompts, analytics or data from another Case.

## 21. Structured AI Output

Require strict JSON:

```json
{
  "fields": [
    {
      "fieldId": "examination_date",
      "status": "extracted",
      "rawValue": "12.08.2026",
      "normalizedValue": "2026-08-12",
      "confidence": 0.96,
      "evidenceIds": ["page-1-block-14"]
    }
  ]
}
```

Reject and safely retry malformed output within limits. Do not request routine narrative explanations.

## 22. Extraction Grouping

Group fields only when they use the same pages or evidence context.

Do not call once per field by default, include unrelated pages, combine unrelated Documents or resend the same page when one compact request can extract related fields.

Choose the grouping with the smallest total reliable context.

## 23. Confidence Policy

```ts
ExtractionConfidencePolicy {
  auto_accept_min
  provider_review_below
  client_review_below
  fail_below
}
```

Thresholds are configurable by task and field risk. Confidence alone never determines approval or rejection.

High-risk fields may always require confirmation, including patient identifiers, policy number, bank account, medical-event date and total amount.

## 24. Caching

```ts
TextCacheKey =
  document_content_hash + page_number + text_extractor_version

OcrCacheKey =
  page_content_hash + ocr_engine_version + language_configuration

ClassificationCacheKey =
  logical_document_hash + document_type_set_version + classifier_version

ExtractionCacheKey =
  logical_document_hash + extraction_schema_version +
  requested_field_set_hash + extractor_version
```

Reuse cache only when relevant inputs and versions match. Never cache by Case ID alone and prevent cross-Case data leakage.

## 25. Selective Reprocessing

Reprocess only for a new Document Version, changed type, changed page composition, changed required-field configuration, explicit retry or authorized engine migration.

When a field is corrected:

1. Preserve the correction.
2. Identify dependent rules.
3. Invalidate only those results.
4. Do not rerun OCR.
5. Do not rerun unrelated extraction.
6. Run AI validation only where applicability or outcome may change.

## 26. Model Routing

```text
Embedded text or deterministic parser → no model
Scanned page → OCR
Stable structured document → specialized extractor
Variable layout or simple ambiguity → small model
Complex medical narrative → standard model
Conflicting high-risk evidence → Provider review, Client HITL or configured escalation
```

Escalate only unresolved fields. Never rerun a complete document through a stronger model merely because one field is unclear.

## 27. Token Budgets

```ts
ExtractionTokenBudget {
  max_input_per_document
  max_output_per_document
  max_calls_per_document_version
  retry_limit
  max_total_per_case
}
```

When a limit is reached, preserve completed results, stop retries and route unresolved fields to Provider review or Client HITL. Never silently exceed the budget.

## 28. Processing Jobs

Processing is asynchronous and idempotent.

```ts
DocumentProcessingJob {
  id
  document_version_id
  task
  status
  attempt
  input_version_hash
  processor
  processor_version
  started_at
  completed_at
  error_code
}
```

Tasks:

```ts
"read_text" | "ocr" | "classify" | "extract" | "normalize"
```

Statuses:

```ts
"queued" | "processing" | "completed" | "failed" | "cancelled" | "superseded"
```

Do not create duplicate active jobs for the same task and input hash.

## 29. Error Handling and UI

Error codes:

```ts
"unsupported_format"
"password_protected"
"corrupted_file"
"ocr_failed"
"classification_failed"
"extraction_failed"
"invalid_model_output"
"processing_timeout"
"budget_exceeded"
"superseded_version"
```

Explain whether the Provider can retry, choose manually, correct a value or upload a replacement. Do not show raw infrastructure errors.

Document statuses:

```text
Reading document
Identifying document type
Waiting for document type
Extracting information
Waiting for your review
Ready for validation
Processing failed
```

Field groups:

```text
Confirmed
Needs review
Missing
Could not be read
```

Users can leave and return without losing progress.

## 30. Security and Privacy

- Process only authorized documents.
- Preserve Provider and Client isolation in every job.
- Keep document contents and extracted values out of logs, analytics and audit payloads.
- Encrypt processing payloads in transit.
- Use approved processors only.
- Record processor and model versions.
- Retain temporary page images and processing artifacts only as configured.
- Never use customer documents for model training without separate explicit authorization.
- Prevent cross-Case cache leakage.
- Recheck authorization before displaying results and evidence.

## 31. Usage and Quality Analytics

Record Case ID without PII, Provider, Client where applicable, Document Version, Scheme version, task, method, engine or model, token counts, cost, duration, cache hit, retry number, confidence band and outcome.

Track automatic classification confirmation rate, correction rate, extraction confirmation and correction rates, unreadable-field rate, processing failure rate, cache hit rate, AI calls per version, tokens per document and cost per completed Case.

## 32. Audit Events

```ts
document_processing_started
document_text_extracted
document_ocr_completed
document_classification_suggested
document_classification_confirmed
document_classification_corrected
document_extraction_completed
extracted_field_confirmed
extracted_field_corrected
extracted_field_marked_absent
document_processing_retried
document_processing_failed
```

Audit identifiers, status, actor, method, version and timestamp without document text or medical values.

## 33. Required Tests

Prove that:

- embedded text precedes OCR
- OCR runs only on required pages
- classification uses configurable Document Types
- unclear types require Provider choice
- Provider-selected types avoid unnecessary AI
- only Scheme-required fields are extracted
- one field is not repeatedly extracted for separate rules
- values have evidence where available
- conflicting candidates are preserved
- corrections preserve machine values
- stale jobs cannot replace current results
- unchanged versions reuse cache
- correction invalidates only dependent rules
- malformed output is safely handled
- token and retry limits are enforced
- Client Admin cannot process standalone documents
- Super Admin cannot access processing inputs or results
- no PII enters analytics, logs or audit payloads
- manual continuation remains available when AI fails

## 34. Required Implementation Output

Before implementing:

1. Inspect Document, Document Version, Scheme, rule and processing models.
2. Identify duplicated OCR, classification and extraction calls.
3. Propose classification, OCR, extraction, evidence and job schemas.
4. Define configurable confidence policies.
5. Define strict model input and output contracts.
6. Implement embedded-text-first and deterministic-first routing.
7. Implement caching and selective reprocessing.
8. Implement Provider confirmation and Client HITL boundaries.
9. Add usage, cost and quality metrics without PII.
10. Add all required authorization, provenance, caching, token-budget and failure tests.

