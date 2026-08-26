# MedConnect — Segment 11: Audit, Security and Privacy — MVP Minimum

## Purpose

Define the minimum controls required before MedConnect processes real Case documents and medical information.

These are MVP requirements, not optional improvements. This specification does not claim legal or security certification.

## 1. Principles

- Deny access by default.
- Enforce authorization in the backend.
- Isolate Provider and Client data.
- Grant minimum required access.
- Store only workflow-required data.
- Keep PII and medical data out of logs, analytics and audit payloads.
- Encrypt data in transit and at rest.
- Preserve immutable history of sensitive actions.
- Never grant Client access from recognized insurer alone.
- Never allow Super Admin access to Cases or documents.
- Never use documents for model training without separate explicit authorization.

## 2. Authentication

MVP requires:

- unique normalized email
- temporary password for invitations
- mandatory password change at first login
- secure password reset
- MFA where configured by platform policy
- immediate denial for suspended or deactivated accounts
- unusable expired or revoked invitations
- no authentication tokens in `localStorage`
- logout that ends the application session
- authorization recheck after account status changes

Do not store passwords in the MedConnect database.

## 3. Backend Authorization

Frontend visibility is not authorization.

Every request verifies authenticated user, active account, role, Provider membership, Client membership where applicable, active relationship where required, Case ownership, Case Client and action permission.

Never trust browser-supplied organization IDs, user IDs, relationship IDs, role or Case owner. Derive or verify them server-side.

## 4. Role Boundaries

### Super Admin

May manage Client Admins, standalone Provider accounts, global rules, platform configuration and aggregate non-PII usage.

Cannot access Cases, documents, extracted values, evidence, patient data or medical data.

### Client Admin

May access Cases explicitly associated with their Client, shared documents, Client HITL, Client-owned rules and Client analytics.

Cannot access standalone Cases, another Client, unrelated Providers or Cases based only on matching `insurer_id`.

### Provider User

May access authorized Cases and documents belonging to their Provider plus Client workflows through active relationships.

Cannot access another Provider, unauthorized Client data, rule administration or Admin functionality.

## 5. Isolation

Use PostgreSQL Row-Level Security on organization-owned tables where practical, including Cases, files, Documents, versions, extracted fields, Validation Runs, HITL, notifications, Client rules and relationships.

RLS must support standalone Provider data, connected Case data, explicit Client access and Super Admin denial.

Application authorization runs in addition to RLS.

Client access requires:

```ts
case.client_id === authenticatedAdmin.client_id
```

This must never grant access:

```ts
case.insurer_id === authenticatedAdmin.client.insurer_id
```

## 6. Document Security

- Store originals immutably.
- Encrypt storage at rest.
- Use TLS for upload and download.
- Validate MIME signature.
- Scan for malware.
- Reject unsafe content.
- Never expose permanent public URLs.
- Use short-lived authorized access or backend streaming.
- Recheck preview, thumbnail and download authorization.
- Keep storage paths out of responses and logs.
- Do not email document attachments.
- Separate temporary processing files from permanent originals.
- Delete temporary files after configured retention.

## 7. Encryption and Secrets

MVP requires TLS, encryption at rest for database, storage and backups, secrets outside source code, separate secrets per environment, no credentials in Git, no model or API keys in frontend code and operational credential rotation.

Production secrets must be unavailable in development.

Field-level application encryption is not required for every database field unless a specific requirement mandates it.

## 8. Data Minimization

Store only Case processing, validation, Client review, audit, non-PII analytics and required retention data.

Do not copy complete document text into unrelated tables.

Never log or analyze patient or policyholder names, diagnosis, treatment, document text, medical values, policy numbers, personal identifiers, unrestricted notes or complete prompts.

## 9. AI Processing Privacy

Only approved OCR or AI providers may receive document content.

Configure processing purpose, permitted data, retention, region where required, service version and disabled provider training.

Send only required pages, passages and fields. Never send unrelated Cases, documents, values or complete Schemes unnecessarily.

Never use Case data for model training without separate explicit authorization.

## 10. Audit Log

Use an append-only audit log:

```ts
AuditEvent {
  id
  event_type
  actor_user_id
  actor_role
  provider_id
  client_id
  case_id
  target_type
  target_id
  action
  source
  reason_code
  created_at
}
```

Exclude document text, medical values, patient names, notes, passwords, tokens and secrets.

Audit records are not editable through the UI.

## 11. Required Audit Events

### Accounts

```ts
user_invited
user_activated
user_updated
user_suspended
user_deactivated
password_reset_requested
login_succeeded
login_failed
```

### Organizations

```ts
provider_created
provider_client_connection_requested
provider_client_connection_activated
provider_client_connection_suspended
provider_client_connection_terminated
```

### Cases

```ts
case_created
case_updated
case_shared_with_client
case_submitted
case_returned
case_accepted
case_rejected
case_liquidated
case_cancelled
case_archived
case_reopened
```

### Documents

```ts
document_uploaded
document_viewed
document_downloaded
document_type_confirmed
document_replaced
document_archived
```

### Validation

```ts
validation_started
validation_completed
validation_failed
extracted_field_corrected
client_review_requested
hitl_resolved
hitl_overridden
```

### Rules

```ts
rule_created
rule_published
rule_archived
scheme_created
scheme_published
rule_added_to_scheme
```

Audit meaningful lifecycle actions rather than every internal machine step.

## 12. Audit Visibility

Client Admin may view history for their Client, associated Cases, Client rules and Client-user actions.

Provider Users may view a filtered user-facing Case history for authorized Cases.

Super Admin may view platform and account-management audit events without Case medical or document information.

## 13. Application Logs

Logs may contain request ID, safe user and organization IDs, endpoint, response status, duration, error code, environment and service version.

Never log sensitive bodies, document content, extracted values, passwords, temporary passwords, tokens, cookies, authorization headers, sensitive prompts or signed URLs.

Use structured logs and stable error codes.

## 14. Analytics Privacy

Permitted analytics properties include internal Case ID, Provider ID, authorized Client ID, Scheme and Rule versions, status, event type, processing method, confidence band, token count, cost, duration and environment.

Never send filenames, notes, document content or extracted values.

## 15. Session and Request Security

MVP requires secure HTTP-only cookies where cookies are used, appropriate `SameSite`, CSRF protection for cookie-authenticated writes, restrictive CORS, security headers, request and upload limits, authentication and password-reset rate limiting, brute-force protection, server-side validation, output encoding and parameterized queries.

Do not expose detailed login errors that enable account discovery.

## 16. Environment Separation

Development, staging and production use separate databases, storage, identity configuration, secrets, model credentials and email settings.

Never copy production patient or Case data into development. Use generated or anonymized test data.

## 17. Backups and Recovery

MVP requires encrypted database backups, durable or backed-up document storage, defined schedule and retention, restricted access, documented restore procedure and at least one verified restore test before launch.

Backups follow live-data privacy requirements.

## 18. Retention and Deletion

Define retention for Cases, documents, audit, logs, analytics, temporary processing files and backups.

For MVP:

- no standard-UI hard deletion for Cases with audit activity
- use deactivation, cancellation or archival
- delete temporary processing artifacts after expiry
- preserve audit history for the required period
- support controlled administrative deletion where legally required
- do not automate permanent deletion until retention rules are approved

## 19. Security Monitoring

Alert on repeated failed login, unusual authorization failures, malware, abnormal downloads, repeated processing failures, disabled accounts attempting access, production service errors and backup failures.

Alerts contain no patient or medical data.

A full SIEM is not required for MVP.

## 20. Error Handling

User-facing errors explain what failed, whether retry is possible and what action is needed.

Never expose stack traces, database messages, internal paths, storage keys, model-provider errors, secrets or security rules.

Include a request ID for investigation.

## 21. Incident Preparation

Before production define who receives alerts, how credentials are revoked, how accounts and document access are disabled, how logs are preserved, how production access is restricted and an internal incident contact list.

A full enterprise incident platform is not required.

## 22. Dependencies and Vulnerabilities

Require lock files, automated dependency scanning, no known critical release vulnerabilities, supported runtimes, prompt critical-patch handling and restricted production deployment permissions.

A formal penetration test may occur later but should happen before large-scale production use where possible.

## 23. Privacy-safe Defaults

- standalone Cases are private
- Clients see only explicitly associated Cases
- documents are never public
- email contains no sensitive content
- analytics contains no PII
- AI receives minimum content
- sessions expire
- archived data stays protected
- exports require authorization
- unclear ownership means denied access

## 24. Out of Scope for MVP

Unless contractually or legally required:

- customer-managed encryption keys
- field-level encryption for every field
- full SIEM
- advanced DLP
- biometric authentication
- external integrations
- automated legal-retention execution
- cross-region disaster-recovery automation
- security certification
- automatic anonymization of historical documents
- Provider self-service account deletion
- unsupervised AI acceptance or rejection

## 25. Required Tests

Prove that:

- unauthenticated requests are denied
- suspended and deactivated users are denied
- Super Admin cannot access Cases or documents
- Client Admin cannot access standalone or another Client’s Cases
- recognized insurer never grants access
- Provider cannot access another Provider
- preview and download recheck authorization
- tenant isolation applies to background jobs
- sensitive actions create audit events
- audit contains no PII
- logs contain no documents, values, credentials or tokens
- analytics contains no PII
- uploads validate MIME and malware status
- expired links cannot access documents
- suspended sessions lose access
- production rejects insecure transport
- backups are encrypted
- temporary files expire as configured

## 26. Required Implementation Output

Before implementing:

1. Inspect authentication, authorization, database, storage, logging and AI configuration.
2. Identify conflicts with Segments 1–10.
3. Define backend guards and RLS policies.
4. Define the append-only audit schema.
5. Define PII-safe logging and analytics.
6. Configure TLS, secure sessions, CORS, CSRF and security headers.
7. Configure encrypted storage and backups.
8. Implement secure document access and malware scanning.
9. Implement minimum security alerts.
10. Add security, isolation, audit and privacy tests.

## MVP Launch Blockers

- backend authorization
- Client and Provider isolation
- no Super Admin Case access
- encrypted transport and storage
- secure document access
- PII-free logs and analytics
- immutable audit history
- privacy-safe AI processing
- encrypted backups with verified restore
- automated tests proving access boundaries

