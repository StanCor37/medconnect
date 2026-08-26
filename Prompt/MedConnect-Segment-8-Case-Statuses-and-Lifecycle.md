# MedConnect — Segment 8: Case Statuses and Lifecycle

## Purpose

Define the operational lifecycle of standalone and Client-connected Cases.

Case status represents the business workflow and remains separate from document-processing status, Validation Run status, rule outcomes, HITL status and external-system status.

## 1. Principles

- Each Case has one current lifecycle status.
- Backend state-machine rules govern every transition.
- Provider Users and Client Admins can perform only authorized actions.
- Super Admins cannot access Case lifecycle data.
- Standalone and Client-connected Cases follow different branches.
- Recognized insurer does not grant access or status permissions.
- Validation results influence allowed transitions but do not replace Case status.
- Background jobs do not create Case statuses.
- Terminal Cases remain available for audit and history.
- Reopening is controlled and audited.
- MedConnect does not execute insurance payments.

## 2. Statuses

```ts
case_status:
  "draft" |
  "documents_in_progress" |
  "ready_for_validation" |
  "validating" |
  "provider_action_required" |
  "client_review_required" |
  "validated" |
  "validated_with_issues" |
  "submitted_to_client" |
  "returned_to_provider" |
  "accepted" |
  "rejected" |
  "liquidated" |
  "closed" |
  "cancelled" |
  "archived"
```

Not every status applies to both Case modes.

## 3. Status Categories

```ts
case_status_category:
  "open" |
  "waiting" |
  "completed" |
  "cancelled" |
  "archived"
```

| Status | Category |
| --- | --- |
| `draft` | open |
| `documents_in_progress` | open |
| `ready_for_validation` | open |
| `validating` | open |
| `provider_action_required` | waiting |
| `client_review_required` | waiting |
| `validated` | completed for standalone, open for connected |
| `validated_with_issues` | completed for standalone, open for connected |
| `submitted_to_client` | waiting |
| `returned_to_provider` | waiting |
| `accepted` | completed |
| `rejected` | completed |
| `liquidated` | completed |
| `closed` | completed |
| `cancelled` | cancelled |
| `archived` | archived |

Do not use category alone for authorization or business logic.

## 4. Status Definitions

### Draft

A Case exists but may not yet have enough information for document preparation. Provider User may edit permitted data, select insurer, Client and Scheme, upload documents or cancel.

Client Admin sees a draft only if it is associated with that Client. Standalone drafts remain private.

### Documents in progress

At least one document exists but preparation is incomplete. Reasons may include missing documents, unclear type, unconfirmed split, unreadable file, replacement request or unresolved field.

Provider continues uploading, replacing, classifying and reviewing. Do not create one Case status for each missing item.

### Ready for validation

Use when a Scheme is selected, required split decisions and types are confirmed, no blocking upload/security task remains and validation may start.

This does not guarantee that all required documents or fields are present.

### Validating

Use while the current Validation Run processes. Prevent duplicate conflicting runs for the same input snapshot.

A document change creates a new input state and may supersede the run.

### Provider action required

Provider must upload or replace a document, confirm a type or split, correct a value or respond to a Client request.

Show one consolidated action list. When resolved, move to ready for validation or validating.

### Client review required

Use only for Client-connected Cases when a rule needs review, HITL policy requires it, rules conflict, high-risk values remain unresolved or Provider requests review.

Standalone Cases never use this status. They become validated with issues and show external-confirmation recommendations.

### Validated

Latest current run passed or passed with permitted warnings.

For standalone Cases this is a completed state. For connected Cases it means MedConnect validation passed but the Case is not necessarily submitted or accepted.

Show:

```text
Validation completed successfully. This does not guarantee acceptance or payment by an Assistance Company or insurer.
```

### Validated with issues

Use when standalone validation finishes with warnings, failed checks or external-confirmation needs. It is not rejection.

Provider may update documents and revalidate, review recommendations, connect and share with a Client or close the Case.

### Submitted to Client

Provider explicitly submits a connected Case for Client handling.

Require active relationship, Client association, pinned Scheme, completed current validation, no unresolved Provider action and explicit confirmation.

The Client may already see a connected Case. Submission represents operational handoff rather than initial authorization.

Store the immutable submission package:

```ts
CaseSubmission {
  id
  case_id
  client_id
  validation_run_id
  document_version_ids
  submitted_by_user_id
  submitted_at
}
```

Later Case changes never silently update this snapshot.

### Returned to Provider

Client requests Provider action after submission or review.

```ts
return_reason:
  "missing_document" |
  "unreadable_document" |
  "incorrect_document" |
  "incorrect_information" |
  "validation_conflict" |
  "additional_information_required" |
  "other"
```

Create clear Provider tasks. After response, return to document preparation, validation, Client review or resubmission as required.

### Accepted

Authorized Client Admin or Client API confirms the submitted Case is accepted for its downstream process. It does not mean payment occurred.

Provider Users cannot accept their own Cases.

```ts
accepted_by_user_id
accepted_at
acceptance_source: "client_admin" | "client_api"
```

### Rejected

Authorized Client rejects a submitted Case. Require reason code, readable reason, actor, timestamp and reviewed submission/run references.

```ts
rejection_reason:
  "documentation_incomplete" |
  "information_inconsistent" |
  "not_eligible" |
  "duplicate_submission" |
  "outside_policy_period" |
  "service_not_covered" |
  "client_decision" |
  "other"
```

Never automatically reject solely because AI fails or confidence is low.

### Liquidated

Use when the Client confirms that its external financial or claims workflow completed successfully.

MedConnect does not execute payment. Provider Users cannot mark liquidation.

```ts
liquidated_at
liquidated_by_user_id
liquidation_source
external_liquidation_reference
```

Only an authorized Client Admin or Client API may mark it.

### Closed

No further MedConnect action is expected without a formal Client outcome. Examples include completed standalone validation or an external workflow completed without imported details.

### Cancelled

The Provider or Client intentionally stops the Case. Require actor, reason and timestamp. Cancellation preserves all data and history.

```ts
cancellation_reason:
  "created_by_mistake" |
  "duplicate_case" |
  "patient_withdrew" |
  "service_not_performed" |
  "submitted_elsewhere" |
  "other"
```

### Archived

Hides an inactive Case from default operational lists without changing its outcome or deleting it.

## 5. Standalone Lifecycle

```text
draft
  → documents_in_progress
  → ready_for_validation
  → validating
  → provider_action_required
  → ready_for_validation
  → validating
  → validated | validated_with_issues
  → closed
  → archived
```

Cancellation branch:

```text
draft | documents_in_progress
  → cancelled
  → archived
```

Standalone Cases never enter Client review, submission, return, acceptance, rejection or liquidation statuses.

## 6. Client-connected Lifecycle

```text
draft
  → documents_in_progress
  → ready_for_validation
  → validating
  → provider_action_required | client_review_required
  → validated | validated_with_issues
  → submitted_to_client
  → client_review_required | returned_to_provider
  → accepted | rejected
  → liquidated | closed
  → archived
```

Not every accepted Case must become liquidated inside MedConnect. This depends on Client configuration and integration.

## 7. Transition Table

| Current | Allowed next | Actor |
| --- | --- | --- |
| `draft` | documents in progress, ready for validation, cancelled | Provider or system |
| `documents_in_progress` | ready for validation, Provider action required, cancelled | Provider or system |
| `ready_for_validation` | validating, cancelled | Provider or system |
| `validating` | Provider action, Client review, validated, validated with issues | System |
| `provider_action_required` | documents in progress, ready for validation, validating, cancelled | Provider or system |
| `client_review_required` | returned, validated, validated with issues, submitted, rejected | Client Admin |
| `validated` | submitted, closed, ready for validation, cancelled | Provider |
| `validated_with_issues` | documents in progress, ready for validation, Client review, submitted, closed, cancelled | Provider or authorized Client |
| `submitted_to_client` | Client review, returned, accepted, rejected, cancelled | Client Admin |
| `returned_to_provider` | documents in progress, ready for validation, validating, submitted, cancelled | Provider |
| `accepted` | liquidated, closed, archived | Client Admin or Client API |
| `rejected` | archived or controlled reopening | Client Admin |
| `liquidated` | archived | Client Admin |
| `closed` | archived or controlled reopening | Authorized Provider or Client |
| `cancelled` | archived or controlled reopening | Authorized Provider or Client |
| `archived` | previous eligible terminal status | Authorized archiving role |

Reject every unlisted transition in the backend.

## 8. Transition Ownership

System controls validation-driven transitions.

Provider controls creation, permitted cancellation, starting validation, submission, standalone closure, returned-Case response and explicit sharing.

Client controls HITL, return, acceptance, rejection, liquidation recording and Client-side closure.

Do not accept arbitrary status updates. Use action commands.

## 9. Action Commands

```text
POST /cases/{id}/start-validation
POST /cases/{id}/share-with-client
POST /cases/{id}/submit
POST /cases/{id}/return-to-provider
POST /cases/{id}/accept
POST /cases/{id}/reject
POST /cases/{id}/mark-liquidated
POST /cases/{id}/close
POST /cases/{id}/cancel
POST /cases/{id}/archive
POST /cases/{id}/restore
POST /cases/{id}/reopen
```

Each command authorizes the actor, verifies current status, validates prerequisites, transitions transactionally, audits and creates permitted notifications.

## 10. Mapping Validation Results

| Validation state | Mode | Case status |
| --- | --- | --- |
| queued or processing | any | validating |
| waiting for Provider | any | Provider action required |
| passed | standalone | validated |
| passed with warnings | standalone | validated or validated with issues by severity |
| issues found | standalone | validated with issues |
| external review needed | standalone | validated with issues |
| Client review needed | connected | Client review required |
| passed | connected | validated |
| passed with warnings | connected | validated or validated with issues |
| Provider correction required | connected | Provider action required |
| technical processing failure | any | remain open and show technical error |

Never set `rejected` from an automated Validation Run. Rejection is a Client decision.

## 11. Sharing a Standalone Case

Explicit sharing preserves history, sets connected mode, assigns Client and relationship, verifies the Scheme, audits and recalculates status.

| Standalone status | Connected status |
| --- | --- |
| draft | draft |
| documents in progress | documents in progress |
| ready for validation | ready for validation |
| validated | validated |
| validated with issues | validated with issues |
| closed | reopen before sharing |

Sharing never automatically submits the Case.

## 12. Reopening

Controlled reopening may be allowed from closed, cancelled or rejected. Require actor, reason, target status, audit and preserved terminal history.

Do not reopen liquidated Cases through the standard UI. Use a separately defined controlled adjustment process.

## 13. Relationship Suspension or Termination

Suspension preserves read access to previously shared Cases while blocking new Cases and sharing. Configuration may allow completion of existing Cases.

Termination preserves history and legally required access, blocks new submissions and never converts connected Cases to standalone automatically.

Relationship changes do not automatically change Case status.

## 14. Changes After Submission

When documents change after submission:

- preserve the submitted snapshot
- mark changes after submission
- notify the Client
- invalidate only dependent results
- require revalidation where needed
- require explicit resubmission when the package changed

Never silently update a submitted package.

## 15. Terminal Statuses

```ts
"accepted" |
"rejected" |
"liquidated" |
"closed" |
"cancelled"
```

Terminal Cases remain visible, preserve history, can be archived and cannot be edited without reopening or adjustment.

## 16. Status History

```ts
CaseStatusHistory {
  id
  case_id
  from_status
  to_status
  actor_user_id
  actor_type
  reason_code
  reason
  source
  created_at
}
```

```ts
transition_source:
  "provider_ui" |
  "client_ui" |
  "system" |
  "provider_api" |
  "client_api"
```

Never update current status without history.

## 17. Concurrency and Idempotency

Use optimistic concurrency and idempotent commands. Check current Case version, expected status, actor and prerequisites.

Repeated API actions with the same idempotency key return the original result.

Reject stale transitions:

```text
This Case changed before your action was completed. Reload it and try again.
```

## 18. Case Lists

Show internal reference, recognized insurer, associated Client, Provider, current status, latest validation result, next action, assignee, created date and updated date.

Never communicate status by colour alone.

Filters:

```text
All
My action
Provider action
Client review
Validated
Completed
Archived
```

Client Admin sees every Case associated with their Client regardless of status. Provider Users see authorized Provider Cases.

## 19. UI Labels

| Internal | UI label |
| --- | --- |
| `draft` | Draft |
| `documents_in_progress` | Documents in progress |
| `ready_for_validation` | Ready for validation |
| `validating` | Validating |
| `provider_action_required` | Provider action required |
| `client_review_required` | Client review required |
| `validated` | Validated |
| `validated_with_issues` | Validated with issues |
| `submitted_to_client` | Submitted to Client |
| `returned_to_provider` | Returned to Provider |
| `accepted` | Accepted |
| `rejected` | Rejected |
| `liquidated` | Liquidated |
| `closed` | Closed |
| `cancelled` | Cancelled |
| `archived` | Archived |

Use actual Client name contextually, for example `Submitted to Dunav Osiguranje`.

## 20. Notifications and SLA

Potential triggers include Provider action, Client review, submission, return, acceptance, rejection, liquidation, cancellation and reopening.

Do not include PII or medical information in notification subjects or analytics.

Store time in status and calculate waiting times, creation-to-validation, submission-to-decision and acceptance-to-liquidation where applicable.

Never modify status history to recalculate SLA.

## 21. Audit Events

```ts
case_status_changed
case_validation_started
case_provider_action_required
case_client_review_requested
case_submitted
case_returned
case_accepted
case_rejected
case_liquidated
case_closed
case_cancelled
case_archived
case_restored
case_reopened
```

Audit Case ID, statuses, actor, source, safe reason and timestamp without PII or content.

## 22. Analytics

Track Cases by status, transition volume, time in status, completion, Provider return, Client review, acceptance, rejection, liquidation, reopening, cancellation and processing durations without PII.

## 23. Required Tests

Prove that:

- transitions follow the state machine
- roles cannot perform unauthorized transitions
- Super Admin cannot access lifecycle data
- standalone Cases cannot enter Client-only statuses
- recognized insurer does not enable Client statuses
- Client Admin sees all associated statuses
- validation issues never automatically reject
- only Client Admin or Client API can accept, reject or liquidate
- Provider cannot accept, reject or liquidate
- submitted snapshots remain immutable
- changes require explicit resubmission
- status history is always created
- terminal Cases require controlled reopening
- liquidated Cases cannot use standard reopening
- stale transitions are rejected
- idempotent commands do not duplicate transitions
- notifications and analytics contain no PII

## 24. Required Implementation Output

Before implementing:

1. Inspect existing Case statuses and transitions.
2. Compare them with both lifecycle modes.
3. Propose the state machine and migration mapping.
4. Define action-specific endpoints.
5. Define guards and role permissions.
6. Define Validation Run-to-Case mapping.
7. Implement immutable status history.
8. Implement submission snapshots.
9. Implement optimistic concurrency and idempotency.
10. Add state-machine, authorization, history and privacy tests.

## Essential Separation

```text
Case status = where the Case is operationally
Validation result = what the rules concluded
Document status = what is happening to a document
HITL status = what the human reviewer must do
External status = what happened in the Client’s own system
```

