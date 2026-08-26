# MedConnect — Segment 5: Document Upload and Versioning

## Purpose

Define how Provider Users upload, capture, classify, split, view, replace and version Case documents.

Document upload must be simple while preserving provenance, validation history and strict access control.

## 1. Core Principles

- Only Provider Users can upload Case documents.
- Upload supports simple drag and drop.
- Taking a photo from a supported mobile device is supported.
- Uploaded documents can be read directly in MedConnect.
- Document Types are configurable through Validation Schemes.
- MedConnect may suggest a Document Type.
- When the type is unclear, the Provider User chooses it.
- One uploaded scan may contain multiple logical documents.
- MedConnect detects and proposes how to split combined scans.
- Provider Users can review and correct proposed splits.
- Replacing a document creates a new version and never overwrites the original.
- Client Admins can view documents shared with their Client but cannot upload Provider documents.
- Super Admins cannot access Case documents.

## 2. Role Permissions

### Provider User

Can:

- upload documents to an authorized Provider Case
- drag and drop one or several files
- capture and upload photos
- preview uploaded documents
- confirm or change a suggested Document Type
- split multi-document scans
- correct page boundaries
- rotate or reorder pages before confirmation
- replace a document with a new version
- add an additional document
- archive an incorrectly uploaded document
- view upload and processing status
- retry failed processing

Cannot:

- upload to another Provider’s Case
- upload to an unauthorized Case
- overwrite historical versions
- modify an immutable source file
- permanently delete documents that have been shared, validated or audited

### Client Admin

Can:

- view documents belonging to Cases shared with their Client
- download documents when permitted
- view Document Type, version and processing status
- request missing, corrected or replacement documents
- compare versions
- use documents during HITL

Cannot:

- upload on behalf of a Provider
- replace Provider documents
- change page composition
- permanently delete Provider documents
- view standalone Case documents
- view another Client’s documents

A Client Admin may flag a potentially incorrect type during HITL but must not silently reclassify the Provider’s source document.

### Super Admin

Super Admin cannot upload, preview, download or otherwise access Case documents or extracted medical information.

## 3. Configurable Document Types

Document Types are configured through Validation Rules and Validation Schemes. Do not hard-code one universal list.

```ts
DocumentTypeDefinition {
  id
  code
  name
  description
  accepted_mime_types
  required
  multiple_allowed
  expected_fields
  classification_hints
  capture_guidance
  display_order
  active
}
```

Examples include medical report, invoice, referral, policy, passport, proof of travel, laboratory result, prescription, discharge summary and other document.

`code` is a stable identifier. `name` and `description` are UI copy.

A Scheme version retains the exact Document Type definitions used for historical validation. Configuration changes apply only to new Scheme versions and explicitly started new validation runs.

## 4. Available Document Types

The type selector shows types from the Case’s pinned Scheme.

For a standalone Case, show types from the selected global Scheme.

For a Client-connected Case, show types from the selected Client or global Scheme.

Always provide:

```text
Other document
```

`Other document` does not satisfy a configured required type unless it is later mapped through an authorized action.

If no Scheme is selected, allow upload and use a limited general type list. Do not reject a document merely because its type is not yet known.

## 5. Upload Methods

### Drag and drop

Provide one clear drop zone:

```text
Drag and drop documents here, or choose files
```

Support single files, multiple files, mixed supported formats and repeated uploads during the Case lifecycle.

Do not require a complex form before upload begins.

### File picker

Provide:

```text
Choose files
```

### Camera capture

On supported mobile devices provide:

```text
Take photo
```

Camera capture must:

- request permission only when needed
- allow review and retake before upload
- detect severe blur, glare, darkness and cropping
- warn when the image may not be readable
- allow multiple photographed pages to form one proposed document
- preserve every original image

The Provider User may continue after a quality warning but must understand that validation may fail.

## 6. Supported Formats and Limits

Initial formats:

```text
PDF
JPEG
PNG
HEIC
WebP
TIFF
```

Convert formats such as HEIC or TIFF to a safe preview representation while preserving the original.

Configure maximum file size, files per upload, pages per file and total upload size per Case.

Validate actual content and MIME signature rather than trusting the extension.

Reject executable files, unreadable password-protected files, corrupted files, unsupported formats, unsafe files and files exceeding limits.

## 7. Upload Pipeline

For each file:

1. Validate authorization.
2. Validate content type and size.
3. Scan for malware.
4. Calculate a cryptographic content hash.
5. Check for an exact duplicate within the authorized Case.
6. Store the immutable original.
7. Generate a safe preview.
8. Determine readability.
9. Detect page count.
10. Detect whether it contains multiple logical documents.
11. Suggest page boundaries.
12. Suggest a Document Type for every logical document.
13. Ask the Provider User to confirm unclear boundaries or types.
14. Create logical Documents and their first versions.
15. Queue extraction and validation after required confirmation.
16. Create non-PII audit events.

Show progress for every file independently. One failed file must not fail the rest of the batch.

## 8. Readability

```ts
readability_status:
  "pending" |
  "readable" |
  "partially_readable" |
  "unreadable" |
  "password_protected" |
  "corrupted"
```

Readability checks include whether the file opens, every page renders, embedded text or scanned text can be read, resolution is sufficient and pages are severely blurred, dark, cropped or obscured.

For partially readable files show:

```text
Parts of this document may be difficult to read. Review the highlighted pages before continuing.
```

For unreadable files show:

```text
This document could not be read. Upload a clearer scan or photo.
```

Actions:

- `Upload replacement`
- `Review document`
- `Keep as attachment`

An unreadable attachment does not satisfy a required readable-document condition.

Do not use an LLM merely to determine whether a file opens or a page has sufficient resolution.

## 9. Document Viewer

Authorized users can read documents directly in MedConnect.

The viewer supports:

- multi-page navigation
- page thumbnails
- zoom
- rotation
- fit to width
- authorized download
- full-screen view
- current and total page count
- Document Type
- version
- readability and processing status

Never expose permanent raw storage URLs. Recheck authorization for every preview, page image and download request.

## 10. Document Classification

MedConnect suggests a type using the configurable types from the Case’s Scheme.

```ts
classification_status:
  "pending" |
  "suggested" |
  "confirmed" |
  "unclear" |
  "failed"
```

```ts
DocumentClassification {
  suggested_type_code
  confidence
  evidence
  classifier_version
}
```

For a high-confidence result, preselect the suggestion and let the Provider User confirm or change it. Never hide the selected type.

For an unclear result show:

```text
We could not determine the document type. Choose the type that best matches this document.
```

Actions:

- `Choose document type`
- `Other document`

Validation rules requiring the document must not continue until the type is confirmed.

Store both the machine suggestion and Provider-confirmed type for quality measurement. The confirmed type becomes active but does not erase the suggestion.

## 11. Classification Efficiency

Use this order:

1. embedded PDF metadata and text
2. filename hints
3. deterministic keyword patterns
4. existing extraction results
5. small classification model only when necessary
6. Provider User choice when unclear

Do not repeatedly classify an unchanged version.

```ts
ClassificationCacheKey =
  document_content_hash +
  available_document_type_set_version +
  classifier_version
```

After Provider confirmation, do not call AI again unless the file or available type configuration changes.

## 12. Multiple Documents in One Scan

One uploaded file may contain several logical documents.

Example:

```text
Pages 1–2: Medical report
Page 3: Referral
Pages 4–5: Invoice
```

Preserve the original upload unchanged.

Create one immutable Source File, separate logical Documents and page-range references connecting each Document to its source pages.

Do not duplicate the source binary for every split unless the storage architecture requires it.

## 13. Split Detection

Use this order:

1. page-level text and metadata
2. blank or separator-page detection
3. barcode or QR separators where available
4. strong header and layout changes
5. page-level classification
6. AI only when cheaper methods remain unclear
7. Provider User confirmation

```ts
ProposedDocumentSplit {
  source_file_id
  start_page
  end_page
  suggested_document_type
  boundary_confidence
  classification_confidence
}
```

## 14. Split Review

When multiple documents are detected show:

```text
This file appears to contain multiple documents. Review how the pages should be separated.
```

Provider Users can preview pages, review boundaries, merge adjacent groups, split a group, move a page, reorder or rotate pages, assign a type to each group and mark irrelevant pages.

Do not begin final validation until required split confirmation is complete.

High-confidence results may be preconfigured but must remain reviewable.

## 15. Page Provenance

```ts
DocumentPageReference {
  document_version_id
  source_file_id
  source_page_number
  document_page_number
  rotation
  included
}
```

Never modify the stored source file. Page exclusion, order and rotation apply to the logical representation only.

## 16. Data Model

```ts
SourceFile {
  id
  case_id
  provider_id
  uploaded_by_user_id
  original_filename
  mime_type
  byte_size
  content_hash
  storage_key
  malware_scan_status
  page_count
  created_at
}
```

```ts
Document {
  id
  case_id
  document_type_code
  current_version_id
  status
  created_by_user_id
  created_at
  archived_at
}
```

```ts
DocumentVersion {
  id
  document_id
  version_number
  source_file_id
  readability_status
  classification_status
  confirmed_type_code
  classification_confidence
  replaces_version_id
  replacement_reason
  created_by_user_id
  created_at
}
```

## 17. Versioning

Replacing a document creates a new immutable `DocumentVersion`. Never overwrite the previous version.

Versions increment within one logical Document. The newest valid version becomes `current_version_id`. Authorized users can access previous versions through version history.

Replacement flow:

1. Select `Upload replacement`.
2. Upload or capture the new file.
3. Confirm its type.
4. Confirm split boundaries where applicable.
5. Select or enter a replacement reason.
6. Create the new version.
7. Set it as current.
8. Invalidate only dependent extraction and validation results.
9. Preserve previous results.
10. Notify the Client where applicable.

```ts
replacement_reason:
  "clearer_copy" |
  "missing_pages" |
  "corrected_document" |
  "wrong_document" |
  "updated_information" |
  "requested_by_client" |
  "other"
```

## 18. Add vs Replace

Clearly distinguish:

```text
Add document
Upload replacement
```

Do not assume a file with the same type replaces an existing one because a Scheme may allow multiple documents of one type.

When unclear ask:

```text
Is this an additional document or a replacement for the existing one?
```

## 19. Exact Duplicate Files

Use the content hash to identify exact duplicates within the Case.

Show:

```text
This file has already been uploaded to this Case.
```

Actions:

- `Open existing document`
- `Cancel upload`

Do not use AI for exact duplicates and do not reveal matches from inaccessible Cases.

## 20. Document Status

```ts
document_status:
  "uploading" |
  "processing" |
  "needs_type_confirmation" |
  "needs_split_confirmation" |
  "ready" |
  "partially_readable" |
  "unreadable" |
  "failed" |
  "archived"
```

A document is `ready` only when upload succeeded, malware scan passed, the file opens, required splits and type are confirmed and preview is available.

Ready for processing does not mean that the document passed validation.

## 21. Asynchronous Processing

Do not make upload requests wait for OCR, classification or splitting.

After secure storage, return upload state, enqueue processing, update statuses as jobs complete, allow the user to leave and return, make retries idempotent and prevent duplicate jobs.

Show per-file progress:

```text
Uploading
Checking file
Reading pages
Identifying documents
Waiting for your confirmation
Ready
Processing failed
```

## 22. Failures and Retries

A failed job must not delete the original upload.

Allow retry of preview generation, OCR, classification, split detection and extraction.

Retries reuse the Source File and do not create a new version unless the file changes. Limit automatic retries and record retry counts.

## 23. Client Document Requests

A Client Admin may request a missing document, clearer copy, missing pages, corrected document or another Document Type.

The request creates a Provider task. The Provider responds by adding or replacing a document. The Client Admin does not upload it.

Link the response to the request for traceability.

## 24. Archival and Deletion

A Provider User may hard-delete an accidental upload only before it has been shared, validated or included in audit-relevant activity.

Otherwise, archive it.

Archived documents remain in version and audit history, are excluded from active validation and remain available to authorized users through history.

Never delete a Source File referenced by any active or historical Document Version.

## 25. Access Control

Document authorization inherits from the Case and verifies Provider membership, Client association and document state.

Client access requires:

```ts
document.case.client_id === authenticatedAdmin.client_id
&& document.case.provider_client_relationship_id !== null
&& relationship.status === "active"
```

Matching `insurer_id` never grants access. Super Admin is always denied.

Apply authorization to originals, previews, thumbnails, split pages, downloads, extracted fields, versions and processing results.

## 26. Storage and Security

- Store originals immutably.
- Encrypt in transit and at rest.
- Isolate storage by Provider and Case.
- Never expose permanent public URLs.
- Use short-lived authorized access or backend streaming.
- Scan files for malware.
- Validate MIME signatures.
- Sanitize display filenames while preserving originals separately.
- Keep document contents out of logs.
- Send documents to external processing only when configured and required.
- Record the external processing provider and version.

## 27. Token and Processing Optimization

- Extract embedded PDF text before OCR.
- Run OCR only for scanned pages or pages without reliable embedded text.
- Process only new or changed versions.
- Reuse rendered pages, OCR text and classification results.
- Use deterministic split signals before AI.
- Send only unclear pages to AI classification.
- Do not send a complete combined scan when page-level evidence is sufficient.
- Do not rerun AI after Provider confirmation.
- Invalidate only rules dependent on a replaced document.
- Cache by content hash, configuration version and engine version.
- Generate repetitive status and readability messages from templates.

## 28. Audit Events

```ts
source_file_uploaded
document_created
document_type_suggested
document_type_confirmed
document_type_changed
document_split_suggested
document_split_confirmed
document_version_created
document_replaced
document_archived
document_processing_retried
document_client_request_created
```

Include safe identifiers, actor, action, versions and timestamp. Exclude content, extracted medical values, patient names and unrestricted notes.

## 29. Analytics

Emit non-PII events:

```ts
document_upload_started
document_upload_completed
document_upload_failed
document_readability_checked
document_classification_suggested
document_classification_corrected
document_split_detected
document_split_corrected
document_replaced
```

Useful properties include MIME family, page count, upload method, readability, confidence band, split count, processing duration, retry count, cached status, Case mode and Scheme version.

Do not send filenames or document content to analytics.

## 30. Required Tests

Prove that:

- only Provider Users can upload
- Super Admin cannot view or upload
- Client Admin can view but cannot upload
- Client access requires explicit Case association and an active relationship
- recognized insurer does not grant access
- standalone documents remain private
- drag and drop accepts multiple files
- camera uploads use the same authorization and versioning
- unclear classifications require Provider choice
- Document Types are Scheme-configurable
- combined scans split into logical Documents
- originals remain immutable
- page provenance survives splitting
- replacements create versions
- historical versions and results remain accessible
- exact duplicates are detected without AI
- unchanged versions are not reprocessed
- one failed upload does not fail the batch
- preview and download endpoints recheck authorization

## 31. Required Implementation Output

Before implementing:

1. Inspect existing Case, Document, storage and Validation Scheme models.
2. Identify hard-coded Document Types.
3. Propose Source File, logical Document, Document Version and page-reference schemas.
4. Define upload, camera, classification, splitting, replacement and preview APIs.
5. Define asynchronous jobs and idempotency rules.
6. Implement authorization before document UI.
7. Implement immutable originals and version history.
8. Implement configurable Document Types.
9. Implement deterministic-first readability, classification and splitting.
10. Add all required authorization, versioning, splitting and failure-isolation tests.

