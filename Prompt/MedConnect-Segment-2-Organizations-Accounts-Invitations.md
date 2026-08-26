# MedConnect — Segment 2: Organizations, Accounts and Invitations

## Purpose

Define Clients, Healthcare Providers, their relationships, account management, invitations and duplicate prevention.

## 1. Organization Model

### Client

A Client is a paying MedConnect customer and may operate as:

- an Assistance Company
- an Insurance Company
- both an Assistance Company and an Insurance Company

Use explicit capabilities rather than one exclusive organization type:

```ts
client_capabilities: Array<
  "assistance_company" |
  "insurance_company"
>
```

A Client must have at least one capability and may have both.

### Provider

A Provider is a healthcare organization or facility, such as a clinic, hospital, diagnostic center, laboratory or individual medical practice.

A Provider User is an individual person working for a Provider. A Provider User does not represent the Provider organization itself.

One Provider can have multiple Provider Users.

For v1, every Provider User belongs to exactly one Provider organization. Support for one person working across multiple Provider organizations can be added later.

## 2. Provider Operating Modes

A Provider can operate in one of two modes:

```ts
provider_mode: "standalone" | "client_connected"
```

### Standalone Provider

A standalone Provider is created by a Super Admin and has no active Client relationship.

Standalone Provider Users can:

- create their own Cases
- upload Case documents
- validate documents against available global rules
- view validation results
- view detected issues
- view missing-document notices
- view recommendations for resolving detected issues

Standalone Provider Users cannot:

- share Cases or documents with a Client
- request Client review
- use Client-owned rules
- submit Cases to a Client
- access Client workflows
- receive a final Client decision through MedConnect

Standalone validation is advisory. MedConnect provides results and recommendations but does not represent that a Client has reviewed or accepted the Case.

### Client-connected Provider

A Provider becomes client-connected when it has at least one active relationship with a Client.

Client-connected Provider Users can:

- create Cases for a connected Client
- upload and validate documents
- use rules available through that Client
- share a Case and its documents with the selected Client
- submit unclear validation results for human review
- receive requests for corrections or additional documents
- see the Client’s Case decision and status where permitted

A Provider may be connected to multiple Clients simultaneously.

Each Case may be associated with no more than one Client. The Provider User selects the relevant Client when creating or submitting the Case.

A Case must not automatically become visible to every Client connected to the Provider.

## 3. Provider–Client Relationships

Do not store one permanent `client_id` on a Provider or Provider User.

Create a many-to-many relationship:

```ts
ProviderClientRelationship {
  id
  provider_id
  client_id
  status
  created_at
  activated_at
  suspended_at
  terminated_at
}
```

Supported statuses:

```ts
"pending" |
"active" |
"suspended" |
"terminated"
```

The combination of `provider_id` and `client_id` must be unique.

A Provider can have multiple active Client relationships. A Client can have multiple connected Providers.

Only an active relationship allows:

- creation of a Case for that Client
- sharing Case documents with that Client
- Client access to the Case
- use of Client-owned Validation Rules
- Client HITL review

Suspending or terminating one relationship must not affect the Provider’s relationships with other Clients.

## 4. Case Ownership and Sharing

Every Case belongs to one Provider and one Provider User who created it. A Case may optionally belong to one Client.

```ts
Case {
  provider_id: required
  created_by_user_id: required
  client_id: nullable
  provider_client_relationship_id: nullable
}
```

### Standalone Case

```ts
client_id = null
provider_client_relationship_id = null
```

A standalone Case is visible only to authorized Provider Users from the owning Provider. It is not visible to any Client or Super Admin.

### Client Case

```ts
client_id = selected Client
provider_client_relationship_id = active relationship
```

A Client Case is visible to:

- authorized Provider Users from the owning Provider
- authorized Admins from the selected Client

The Client can see the Case immediately after it is shared or created for that Client. Client visibility does not depend on Case status.

The Client Case list must include all Cases shared with that Client, subject to search and filtering.

Documents belonging to a Client Case are shared only with the selected Client.

## 5. Human-in-the-loop Review

HITL review is available only for Cases associated with a Client.

When deterministic or AI validation cannot provide a clear result, the Case may enter:

```ts
needs_client_review
```

The Client Admin can:

- review the unclear rule result
- review relevant Case documents
- confirm the proposed result
- override the proposed result with a reason
- request additional documents
- return the Case to the Provider
- reject the submission where permitted by the workflow

Every HITL action must be audited with the Case ID, rule version, acting user, original result, final result, reason and timestamp.

Standalone Cases do not support Client HITL. They show recommendations and identify unclear results as requiring external confirmation.

## 6. Account Center

Provide an Account Center for Super Admins and Client Admins.

### Super Admin Account Center

Super Admin can:

- create Client Admin accounts
- create standalone Provider organizations
- create Provider Users for standalone Providers
- update accounts within the Super Admin scope
- suspend or deactivate accounts within the Super Admin scope
- delete eligible accounts within the Super Admin scope
- resend or reset an invitation
- view invitation and account status

Super Admin cannot manage Provider Users created and managed by a Client Admin.

### Client Admin Account Center

Client Admin can:

- create Provider organizations connected to their Client
- invite an existing Provider to connect
- create Provider Users within their managed Provider relationships
- update those Provider Users
- suspend or deactivate those Provider Users
- delete eligible Provider Users
- resend or reset an invitation
- view invitation and account status

Client Admin cannot manage Super Admins, other Client Admins, unrelated standalone Providers or Provider Users outside the Client’s authorized relationships.

### Provider User Account Settings

Provider Users can:

- update their own name
- update permitted profile information
- change their password
- configure MFA
- view their Provider and Client connections

Provider Users cannot delete or deactivate their account, change their Provider organization, create or remove Client relationships or change their role.

## 7. Invitation Flow

Accounts are created using an email address and temporary password.

Required flow:

1. An authorized Super Admin or Client Admin enters the user’s email and profile details.
2. The system checks whether the email already belongs to an existing account.
3. If no account exists, create it and send an invitation with temporary-password instructions.
4. At first login, require the user to set a permanent password.
5. Require MFA enrollment when configured by platform policy.
6. Mark the account active only after required activation steps are complete.

Invitation statuses:

```ts
"pending" |
"accepted" |
"expired" |
"revoked"
```

Account statuses:

```ts
"invited" |
"active" |
"suspended" |
"deactivated"
```

Do not send passwords to application logs or analytics.

Temporary passwords must expire, be single-use, become invalid after invitation revocation or reset and require a permanent password at first login.

## 8. Account Suspension, Deactivation and Deletion

Account management follows ownership boundaries:

- Super Admin manages accounts created within the Super Admin scope.
- Client Admin manages accounts created within that Client’s scope.
- Provider Users cannot suspend, deactivate or delete their own accounts.

### Suspension

Suspension is reversible.

A suspended user cannot sign in, create Cases or modify Cases. The user remains visible in historical records and audit logs.

### Deactivation

Deactivation is intended to be permanent unless restored by an authorized administrator.

A deactivated user cannot sign in or receive new Case assignments. The user remains attached to existing Cases and audit events.

### Deletion

Use hard deletion only for accounts that have never activated and have no Cases, document activity, HITL decisions or audit-relevant activity.

Otherwise, the Delete action must perform soft deletion or deactivation.

Historical Case ownership and audit events must never be removed because an account was deactivated or deleted.

## 9. Connecting a Standalone Provider to a Client

A standalone Provider can later connect to one or more Clients without creating a new Provider organization or new Provider User accounts.

Connection flow:

1. Client Admin searches for or invites the Provider.
2. The system checks for an existing Provider.
3. If the Provider exists, create a pending Provider–Client relationship.
4. An authorized Provider User accepts the connection.
5. The relationship becomes active.
6. The Provider may create and share new Cases with that Client.

Existing standalone Cases remain standalone by default.

Do not automatically expose historical standalone Cases to a newly connected Client.

A Provider User may explicitly share or associate an eligible existing Case with a Client through a separate confirmed action. Audit this action.

## 10. Duplicate Detection and Resolution

### Duplicate User Detection

Treat normalized email address as the primary unique identifier for a person. Normalize email by trimming whitespace and converting it to lowercase.

Before creating a user:

1. Search for an exact normalized-email match.
2. If an active account exists, do not create another account.
3. Offer the appropriate connection or invitation flow for the existing account.
4. If an invited account exists, offer to resend or reset the invitation.
5. If a suspended or deactivated account exists, require an authorized administrator to restore or review it.
6. Never automatically merge two user accounts.

Protect normalized email addresses with a database-level unique constraint.

### Duplicate Provider Detection

Use the following identifiers where available:

- country
- official registration number
- tax identification number
- healthcare-provider licence number
- normalized legal name
- address

Use official registration number or tax identification number plus country as the strongest duplicate key.

Before creating a Provider:

1. Search for exact official-identifier matches.
2. Search for possible matches using normalized name and address.
3. Block creation on an exact official-identifier match.
4. Warn the administrator about probable name or address matches.
5. Allow creation after a warning only when no official identifier conflicts.
6. Record who confirmed that the Provider was not a duplicate.

Do not automatically merge Provider organizations.

### Duplicate-resolution Process

An authorized administrator may:

- confirm that records represent different Providers
- connect the user to the existing Provider
- correct the new record
- deactivate an unused duplicate
- request Super Admin review when records already contain activity

Providers or users with Cases, documents or audit history must not be automatically merged or deleted.

## 11. Required Authorization Rules

Authorization must consider user role, Provider membership, Client membership, active Provider–Client relationship, Case ownership and account status.

Never authorize Provider access using `client_id` alone.

A Provider User working with multiple Clients keeps one account and one Provider membership. Access to each Client is derived through the Provider–Client relationship.

## 12. Required Implementation Output

Before implementing this segment:

1. Inspect the existing User, Client, Provider and Case models.
2. Identify assumptions that Provider Users belong directly to one Client.
3. Propose migrations for Provider, Provider membership and Provider–Client relationships.
4. Explain how existing accounts and Cases will be migrated.
5. Implement backend authorization before relying on frontend visibility.
6. Add automated tests for account ownership, invitations, Provider connections and Case visibility.

