# MedConnect — Segment 1: Roles, Permissions and Data Visibility

## Purpose

Define the MedConnect roles and the data each role may access. All authorization must be enforced by the backend. Hiding UI elements is not sufficient.

MedConnect has three roles:

- `super_admin` — MedConnect platform team
- `client_admin` — user representing an Assistance Company, Insurance Company or both
- `provider_user` — individual working for a Healthcare Provider

## 1. Super Admin

The Super Admin is a platform-level user and does not belong to a Client or Provider.

### Can

- Create and manage Client Admin accounts.
- Create and manage standalone Provider organizations and their Provider Users.
- Create, view, edit, archive and publish global Validation Rules.
- View Client-owned Validation Rules for governance and reuse.
- Reuse a Client-owned rule as the basis for a new global rule.
- Promote an eligible Client-owned rule to the global rule catalog.
- View rule metadata including owner, version, status, creation date and usage count.
- View platform-level rule usage and system analytics without Case-level, patient-level or medical data.

### Cannot

- View Provider Users created and managed by a Client Admin.
- View Cases belonging to Client-managed Provider Users.
- View Cases belonging to standalone Provider Users.
- View Case documents or extracted patient and medical data.
- Perform Case validation.
- Access personally identifiable or medical information.
- Silently modify a Client-owned rule.

Creating or managing a standalone Provider User account must not grant the Super Admin access to that Provider User’s Cases or documents.

When a Client-owned rule is promoted or reused globally, create a new global rule with a reference to its source. Do not change ownership of the original rule and do not update existing Cases retroactively.

## 2. Client Admin

A Client Admin belongs to exactly one Client. The Client may be an Assistance Company, Insurance Company or both.

### Can

- Create and manage Provider organizations and Provider Users within their Client relationships.
- View Provider Users managed within their Client scope.
- View all Cases shared with their Client, regardless of Case status.
- Open Case details, documents, validation results and review history for Cases shared with their Client.
- Perform human review when a rule result is unclear.
- Request corrections or additional documents from the Provider.
- View the global Validation Rule catalog.
- Apply a matching global rule without recreating it.
- Create Client-owned rules when no suitable global rule exists.
- View, edit, version and archive Client-owned rules.
- View Client-level analytics and rule usage.

### Cannot

- View or manage other Clients.
- View standalone Providers that are not connected to their Client.
- View standalone Cases that have not been shared with their Client.
- View Provider Users or Cases outside their Client relationships.
- Create or manage Super Admins.
- Edit, archive or delete global rules.

Case status must not restrict Client Admin visibility. A Client Admin can see every Case shared with their Client, including draft, processing, incomplete, failed, rejected and completed Cases.

Before allowing a Client Admin to create a Client-owned rule, search available global rules and show potential matches. The Admin may apply a global rule directly. Do not create a duplicate Client-owned rule merely because a global rule is being used.

## 3. Provider User

A Provider User is an individual person working for a Provider organization.

A Provider may operate independently or have active relationships with one or more Clients. The Provider User keeps one account while the Provider may work with multiple Clients.

### Can

- Create Cases for their Provider.
- View Cases they are authorized to access within their Provider.
- Upload Case documents.
- replace documents or upload new document versions.
- Select an applicable Validation Rule.
- Validate uploaded documents against the selected rule version.
- View document requirements, extracted fields, detected issues and recommendations.
- Correct extracted values when permitted.
- Upload missing documentation.
- Resubmit documents for validation.
- Share a Case with one connected Client.
- Submit unclear validation results for Client HITL when the Case is connected to a Client.

### Cannot

- Access Super Admin functionality.
- Access Client Admin configuration.
- View or manage Admin accounts.
- View or manage other Provider organizations.
- Create, edit, archive or delete Validation Rules.
- View rule ownership, internal notes or platform-wide usage.
- View Cases outside their Provider authorization.
- Share one Case with multiple Clients simultaneously.
- Change a Case’s Client without an explicit audited reassignment flow.
- Access Client-level or platform-level analytics.
- Delete or deactivate their own account.

### Standalone Provider User limitations

A standalone Provider User may:

- create Cases
- upload documents
- validate documents against available global rules
- view validation results and recommendations

A standalone Provider User cannot:

- use Client-owned rules
- request Client HITL
- submit a Case to a Client without an active Provider–Client relationship
- represent validation recommendations as Client approval

## 4. Rule Ownership and Visibility

Every Validation Rule has one of the following scopes:

- `global` — owned and managed by MedConnect
- `client` — owned and managed by one Client

A global rule can be applied by multiple Clients and standalone Providers without creating separate copies.

A Client-owned rule is available only within the owning Client’s active Provider relationships.

Provider Users see only the information required to select a rule, understand document requirements and validate documents. They do not see rule administration details such as ownership, internal notes, cross-Client usage or version-management controls.

Rules must be versioned. Every Case must retain the exact rule version used for validation. Editing or publishing a new version must not change the historical result of an existing Case.

## 5. Case Ownership and Visibility

Every Case belongs to one Provider and has one creating Provider User. A Case may optionally be associated with one Client.

| Role | Case visibility |
| --- | --- |
| Super Admin | No Case access |
| Client Admin | All Cases shared with their Client, regardless of status |
| Provider User | Cases authorized within their Provider |
| Other Clients | No access |

A standalone Case has no Client and is not visible to any Client Admin.

A Client-connected Case is visible to the selected Client immediately after it is created for or shared with that Client. Visibility must not depend on Case status.

These restrictions must apply to:

- list endpoints
- search
- direct Case URLs
- document endpoints
- validation results
- exports
- analytics drill-downs
- API responses

A user must not be able to bypass restrictions by supplying another `client_id`, `provider_id`, `provider_user_id` or `case_id`.

## 6. Security Requirements

- Deny access by default.
- Enforce permissions in backend services and database queries.
- Never trust organization identifiers supplied by the browser.
- Revalidate authorization when opening a Case, document or validation result directly.
- Record permission-sensitive actions in an audit log.
- Do not store patient data, document contents or extracted medical values in application logs.
- Return `403 Forbidden` for authenticated users attempting prohibited actions.
- Return `404 Not Found` when revealing another organization’s resource would create an information leak.
- Authorization must consider role, Provider membership, Client membership, active Provider–Client relationship, Case ownership and account status.
- Do not authorize Provider access using `client_id` alone.

## 7. Required Implementation Output

Before implementing this segment:

1. Inspect the existing authentication, User, Client, Provider, Case and Validation Rule models.
2. Report conflicts between the existing implementation and this specification.
3. Propose the required data-model and authorization changes.
4. Explain how existing records will be migrated.
5. Implement backend authorization before relying on frontend visibility.
6. Add automated permission tests for every allowed and denied role-resource combination.

