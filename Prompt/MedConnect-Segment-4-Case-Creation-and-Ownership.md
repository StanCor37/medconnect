# MedConnect — Segment 4: Case Creation and Ownership

## Purpose

Define how Cases are created, identified, owned, connected to Providers and Clients and made visible to authorized users.

This segment covers Case identity, creation and ownership. Document processing, validation results and the complete status lifecycle are defined separately.

## 1. Case Definition

A Case is one document-validation work item created by a Provider User.

A Case always belongs to:

- one Provider organization
- one creating Provider User

A Case may optionally reference:

- one recognized insurer
- one Client
- one active Provider–Client relationship
- one Validation Scheme version
- one external reference

A Case can never be shared with multiple Clients simultaneously.

## 2. Case Modes

```ts
case_mode: "standalone" | "client_connected"
```

### Standalone Case

A standalone Case is created without sharing it with a Client. It is used to upload and validate documents, identify missing or inconsistent information and show recommendations.

```ts
case_mode = "standalone"
client_id = null
provider_client_relationship_id = null
```

A standalone Case may still identify an insurer.

```ts
insurer_id = recognized insurer | null
```

It is not visible to Super Admins, Client Admins, recognized insurers or unrelated Providers.

Its validation result is advisory and must not be presented as Client approval.

### Client-connected Case

A Client-connected Case is created for or explicitly shared with one Client.

```ts
case_mode = "client_connected"
client_id = selected Client
provider_client_relationship_id = active relationship
```

It can use rules available through that Client, share documents and validation results, request Client HITL and receive Client feedback.

Only Clients with an active relationship with the Provider may be selected.

## 3. Insurer Recognition Is Not Client Authorization

An insurer referenced by a Case and a Client authorized to access the Case are separate concepts.

```ts
Case {
  insurer_id: nullable
  client_id: nullable
  provider_client_relationship_id: nullable
}
```

`insurer_id` identifies the insurer whose documentation or requirements appear relevant. It may be selected by the Provider User, extracted from documents, received through an API or suggested by MedConnect and confirmed by the Provider User.

Recognizing an insurer never grants that insurer access to the Case.

Example:

```ts
insurer_id = "dunav_osiguranje"
client_id = null
provider_client_relationship_id = null
case_mode = "standalone"
```

MedConnect recognizes Dunav Osiguranje and may apply relevant published global rules. Dunav cannot see the Case, documents, validation results or Provider information.

Client access must never be inferred from `insurer_id`, even when an insurer catalog record and Client represent the same legal organization.

The following must never grant access:

```ts
case.insurer_id === authenticatedAdmin.client.insurer_id
```

Client visibility requires an explicit `client_id`, an active relationship and authorization for that Client.

## 4. Who Can Create Cases

### Provider User

A Provider User can:

- create a standalone Case
- create a Case for a connected Client
- convert an eligible standalone Case into a Client-connected Case
- continue a saved draft
- create separate Cases for different Clients

Provider Users create Cases only within their own Provider organization.

### Client Admin

For v1, a Client Admin views and reviews Cases shared with their Client but does not create Cases on behalf of Providers.

Do not silently add Client-side Case creation. If introduced later, define a separate Provider-selection, assignment and acceptance workflow.

### Super Admin

Super Admin cannot create, view or manage Cases.

### API

An authenticated Provider integration may create Cases when its API key has the required scope. API-created Cases follow the same ownership, relationship and visibility rules as UI-created Cases.

## 5. Case Data Model

```ts
Case {
  id
  internal_reference
  case_mode
  source
  status

  provider_id
  created_by_user_id
  assigned_to_user_id

  insurer_id
  client_id
  provider_client_relationship_id
  validation_scheme_version_id

  external_reference
  external_reference_source

  patient_reference
  service_type
  event_date

  version
  created_at
  updated_at
  submitted_at
  archived_at
}
```

Do not store patient names or medical information in audit logs, analytics events or reference numbers.

## 6. Internal Reference

Every Case receives a backend-generated immutable internal reference unique across MedConnect.

Recommended format:

```text
MC-YYYY-NNNNNNN
```

The reference must not contain PII, reveal document contents or be supplied by the frontend. Protect it with a database-level unique constraint.

Do not calculate the next reference by counting existing Cases.

## 7. External Reference

An external reference is optional and never replaces the MedConnect internal reference.

```ts
external_reference_source:
  "client" |
  "insurer" |
  "provider" |
  "partner_api" |
  "manual"
```

Recommended scoped uniqueness:

```ts
unique(
  provider_id,
  client_id,
  external_reference_source,
  external_reference
)
```

For a standalone Case, `client_id` is null.

## 8. Case Creation Flow

### Step 1: Start Case

The Provider User creates a Case within their Provider. Generate the internal reference immediately.

### Step 2: Recognize Insurer

Allow the Provider User to:

- select an insurer
- confirm or change an insurer suggested by MedConnect
- continue without an insurer

Insurer recognition affects which global rules may be relevant. It does not share the Case.

### Step 3: Choose Client Association

Allow the Provider User to:

- choose an available connected Client
- continue independently without a Client

The Client list contains only Clients with an active Provider–Client relationship.

If the Provider has one active relationship, it may be preselected but must remain visible and changeable.

A recognized insurer that is not connected may be displayed for context but must not appear as an available Client.

Selecting a Client associates the Case with that Client and enables Client-owned schemes and HITL. It does not automatically submit the Case.

### Step 4: Enter Case Details

Required minimum information:

- Case type
- patient reference
- event or service date where applicable

Optional information:

- recognized insurer
- external reference
- external-reference source
- Provider internal note

Do not require document-derived information during initial creation if it can be extracted later.

### Step 5: Choose Validation Scheme

If MedConnect cannot select a scheme automatically, allow the Provider User to choose from authorized Clients and available Schemes.

Show:

```text
No Validation Scheme was selected automatically. Choose an available Client and Validation Scheme to continue.
```

Provider User actions:

- choose an active connected Client
- continue without a Client
- choose an available Validation Scheme
- review or change the recognized insurer
- continue with general validation when an applicable global scheme exists

When no Client is selected, show:

- published global Schemes
- global Schemes applicable to the recognized insurer
- general document-validation Schemes

When a Client is selected, show:

- published Schemes owned by that Client
- published global Schemes enabled for that Client
- Schemes compatible with the selected insurer where applicable

Do not show draft Schemes, archived Schemes for new Cases, another Client’s Schemes or private Client Schemes without an active relationship.

Recommended fields:

```text
Recognized insurer
Client
Validation Scheme
```

Recommended actions:

```text
Continue
Continue independently
Change insurer
```

If no Client is selected, `Continue independently` creates or preserves a standalone Case.

If an active Client and compatible Scheme are selected, continue as a Client-connected Case.

A Scheme is required before validation begins but not before the Case is saved.

### Step 6: Complete Creation

The backend must:

1. Revalidate Provider membership.
2. Revalidate the Provider–Client relationship where applicable.
3. Validate insurer, Client and Scheme compatibility.
4. Confirm the internal reference.
5. Pin the selected Scheme version where selected.
6. Save the Case.
7. Create a non-PII audit event.
8. Return only the authorized Case view.

## 9. Draft Cases

A Case may be saved before documents are uploaded or a Scheme is selected.

A draft must contain Provider, creating Provider User, Case mode, selected Client where applicable, internal reference and creation timestamp.

Drafts follow normal visibility rules. A selected Client can see a Client-connected draft. No Client can see a standalone draft.

Do not assume autosave unless explicitly implemented.

## 10. Scheme Assignment

A Case must pin an exact published Validation Scheme version before validation.

```ts
validation_scheme_version_id: required before validation
```

The Scheme must be compatible with Case mode, Client, active relationship, insurer, product line and jurisdiction where applicable.

Publishing a new version must not update an existing Case automatically.

Before validation, an authorized Provider User may change the Scheme if the replacement is applicable.

After validation begins, a change requires explicit confirmation, invalidation of dependent results, a new validation run and preservation of previous history.

A Client Admin may recommend another Scheme during HITL but must not replace it silently.

## 11. Case Ownership Within a Provider

The Provider organization is the business owner of the Case. Preserve the original creator permanently.

```ts
created_by_user_id
assigned_to_user_id
provider_case_access: "creator_only" | "provider_shared"
```

Recommended default:

```ts
provider_case_access = "provider_shared"
```

Authorized users within the same healthcare facility may collaborate while the original creator remains recorded.

Changing Provider access must never expose a Case to another Provider.

## 12. Client Visibility

A Client Admin sees every Case explicitly associated with their Client regardless of Case status.

Visibility begins only when the Case is created for that Client or explicitly shared with that Client.

The existence of a Provider–Client relationship alone does not expose all Provider Cases. Recognizing the Client’s insurer does not expose the Case either.

Client authorization requires:

```ts
case.client_id === authenticatedAdmin.client_id
&& case.provider_client_relationship_id !== null
&& relationship.status === "active"
```

## 13. Standalone Case with Recognized Insurer

For a standalone Case with a recognized insurer, MedConnect may:

- apply published global rules associated with that insurer
- validate documents
- identify missing or inconsistent information
- show recommendations
- suggest connecting with the relevant Client

MedConnect must not:

- expose the Case to that insurer or Client
- create Client HITL tasks
- apply private Client-owned rules
- submit the Case
- treat insurer recognition as authorization

Inform the Provider User:

```text
Dunav Osiguranje was identified as the insurer. You can validate the documents using available global rules, but the Case will not be shared with Dunav Osiguranje.
```

## 14. Sharing a Standalone Case

A standalone Case may later be shared with a connected Client.

Required flow:

1. Provider User selects `Share with Client`.
2. Show only active Client relationships.
3. Provider User selects one Client.
4. Explain which Case data, documents and results will become visible.
5. Require explicit confirmation.
6. Verify or replace the Scheme with a compatible available Scheme.
7. Set `client_id` and `provider_client_relationship_id`.
8. Change `case_mode` to `client_connected`.
9. Audit the sharing action.

Existing standalone Cases remain standalone by default after the Provider connects to a Client.

Never automatically share historical Cases.

Before confirmation, show:

```text
Sharing this Case will give {Client name} access to its details, documents and validation results.
```

## 15. Client Reassignment

Do not directly move a Case from Client A to Client B.

Recommended workflow:

1. Cancel or close the submission to Client A where permitted.
2. Preserve its complete history.
3. Create a new Case through `Duplicate for another Client`.
4. Generate a new internal reference.
5. Select Client B and a compatible Scheme.
6. Explicitly select which documents may be copied.
7. Audit the relationship between the original and new Case.

Do not expose Client A’s rules, reviews or decisions to Client B.

## 16. User Suspension, Deactivation and Reassignment

If the creating Provider User is suspended or deactivated, the Case remains owned by the Provider and is not deleted. Preserve `created_by_user_id`, Client visibility and audit history.

When Provider sharing is enabled, authorized colleagues may continue the work.

Reassignment to another user within the same Provider must preserve the creator, update `assigned_to_user_id` and create an audit event. It must never move the Case to another Provider.

## 17. Duplicate Case Detection

Before creation, check Provider, Client, external reference, patient reference, insurer, event date and service type.

Block creation when the same scoped external reference exists. Show the existing Case only when the user may access it.

For probable matches, warn and allow the user to open the existing Case, cancel or continue with a reason.

Do not use AI for exact duplicate detection and never reveal inaccessible Cases.

## 18. API Creation and Idempotency

API Case creation requires:

```ts
cases:write
```

Bind the API key to a Provider. Validate any requested Client against an active relationship.

Do not trust supplied `provider_id`, `client_id`, relationship ID or Scheme scope. Derive or verify them against the authenticated identity.

Require an idempotency key:

```http
Idempotency-Key: unique-request-value
```

Repeated requests with the same valid key return the original result rather than creating duplicates.

## 19. Editing and Selective Revalidation

Provider Users may edit permitted metadata before submission or validation.

Changes affecting validation invalidate only dependent results:

- event-date change invalidates date-dependent rules
- insurer change may affect available global rules and Scheme compatibility
- Client change uses the controlled reassignment workflow
- Case-type change may invalidate Scheme compatibility
- informational-note changes do not invalidate validation

Client Admin corrections during HITL must preserve both the Provider value and reviewed value where provenance matters.

## 20. Deletion and Archival

Allow hard deletion only when a draft has no documents, validation runs, Client sharing or audit-relevant downstream activity.

Otherwise archive or cancel it.

Archived Cases remain available to authorized roles and audit history, are excluded from default active lists and cannot receive new documents or validation runs unless restored.

Super Admin cannot delete or archive Cases.

## 21. Concurrent Updates

Use optimistic concurrency control with a Case version or `updated_at` value.

Reject stale updates, preserve newer data and require the user to reload. Never silently overwrite another user’s work.

## 22. Audit Events

Record:

```ts
case_created
case_updated
case_insurer_recognized
case_shared_with_client
case_scheme_assigned
case_scheme_changed
case_assigned
case_duplicate_warning_overridden
case_archived
case_restored
```

Include Case ID, actor ID and role, Provider ID, Client ID where applicable, safe changed-field names and timestamp.

Do not include patient names, medical values, document contents or unrestricted notes.

## 23. Analytics Events

Emit:

```ts
case_created
case_mode_selected
case_insurer_selected
case_client_selected
case_scheme_selected
case_duplicate_detected
case_shared_with_client
```

Analytics must contain no PII.

Useful properties include source, Case mode, presence of an external reference, Scheme and version IDs, Client ID where applicable, Provider ID, duplicate outcome and environment.

## 24. UI States and Copy

### Recognized insurer without Client connection

```text
{Insurer name} was identified as the insurer. You can validate the documents using available global rules, but the Case will not be shared with {Insurer name}.
```

Actions:

- `Continue independently`
- `Review insurer`
- `Request connection`

### No insurer recognized

```text
Select an insurer to find relevant validation rules or continue with general document validation.
```

### No automatic Scheme match

```text
No Validation Scheme was selected automatically. Choose an available Client and Validation Scheme to continue.
```

### Connected but not shared

```text
This Case has not been shared with {Client name}. Only your Provider can currently access it.
```

### Duplicate external reference

```text
A Case with this external reference already exists.
```

### Inactive relationship

```text
This Provider is no longer connected to the selected Client. Choose another available Client or continue independently.
```

### Concurrent update

```text
This Case was updated by another user. Reload it before making further changes.
```

## 25. Security Requirements

- Enforce Provider and Client access in the backend.
- Use database constraints for internal and scoped external references.
- Never trust organization IDs from the frontend.
- Never expose inaccessible Case existence.
- Pin exact Scheme versions.
- Audit sharing and reassignment.
- Prevent Super Admin Case access.
- Prevent cross-Client Case access.
- Prevent every Client from accessing standalone Cases.
- Apply authorization to documents, validation results, exports and direct URLs.
- Never treat `insurer_id` as authorization.

## 26. Required Implementation Output

Before implementing:

1. Inspect existing Case, User, Provider, Client, Insurer and Validation Scheme models.
2. Identify conflicts with Segments 1–3.
3. Propose the Case schema, indexes and constraints.
4. Define UI and API creation contracts.
5. Implement standalone and Client-connected flows.
6. Implement insurer recognition separately from Client association.
7. Implement backend authorization before frontend visibility.
8. Implement API idempotency and duplicate-reference protection.
9. Implement Scheme-version pinning.
10. Implement explicit standalone-to-Client sharing.
11. Add tests for ownership, insurer recognition, Client visibility, standalone privacy, manual Client and Scheme selection, duplicates, API idempotency, archival and concurrent updates.

