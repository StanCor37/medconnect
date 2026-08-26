# MedConnect — Segment 12: UI Structure and Navigation

## 1. Purpose

Define the application structure, role-based navigation and primary screens for the MedConnect MVP. Use one shared design system and application shell, while showing each role only the areas it may access.

Hiding a navigation item is not authorization. Every route, API request and data query must enforce the permissions defined in Segments 1–11.

## 2. Product Structure

MedConnect supports three roles:

- `super_admin`
- `client_admin`
- `provider_user`

The Provider interface must support both standalone and Client-connected work. These are operating modes of the same Provider account, not separate applications.

## 3. Shared Application Shell

Use a consistent shell containing:

- A role-specific left navigation on desktop.
- A collapsible menu on smaller screens.
- A top bar with the page title, current organization where relevant, notifications and user menu.
- A user menu containing Account Settings, Change Password, Notification Preferences and Sign Out.
- Provider connection management where applicable.

Users cannot switch into a role they do not hold.

## 4. Responsive Behavior

- Admin interfaces are desktop-first but must remain usable on tablets.
- Provider workflows must support desktop, tablet and mobile, especially document upload, camera capture, Case actions and validation results.
- Convert wide tables into responsive cards or controlled horizontal views.
- Use a full-screen or bottom-sheet camera experience on mobile.
- Keep the Case reference and status visible during long Case workflows.
- Do not make any action available only on hover.

## 5. Super Admin Navigation

Primary navigation:

1. Overview
2. Clients
3. Global Rules
4. Global Schemes
5. Admin Accounts
6. Standalone Providers
7. Usage
8. Account Center

The Super Admin interface must not expose Cases, Case documents, validation results, Client reviews or Provider Case activity.

### 5.1 Overview

Show non-PII operational totals such as Clients, active administrators, global Rules, global Schemes and aggregate system usage. Metrics must not drill into Case or document content.

### 5.2 Clients

Allow creation, editing, suspension and capability configuration for Client organizations. Do not expose the Client's Cases or documents.

### 5.3 Global Rules

Provide search, duplicate detection, drafting, versioning, publishing, archiving, reuse and promotion to global scope.

### 5.4 Global Schemes

Allow the Super Admin to create a Scheme, add and order Rules, configure parameters, preview the compiled Scheme, publish a version and archive it.

### 5.5 Admin Accounts

Allow invitations, profile updates, suspension and deactivation of Client Admin accounts. Do not show Provider Users managed by Client Admins.

### 5.6 Standalone Providers

Allow account creation, profile management, suspension and connection administration for Providers created by the Super Admin. Do not show their Cases.

### 5.7 Usage

Show aggregate, non-PII platform usage only.

## 6. Client Admin Navigation

Primary navigation:

1. Overview
2. Cases
3. Reviews
4. Providers
5. Rules
6. Validation Schemes
7. Analytics
8. Account Center
9. Notifications

### 6.1 Overview

Show Client-scoped KPIs, recent Case activity, pending reviews, validation outcomes and operational alerts.

### 6.2 Cases

Show all Cases explicitly associated with the Client, in every status. Provide server-side search, filtering, sorting, pagination and authorized export.

Recognizing the Client or insurer in Case data does not grant access. A Case is visible only when the Provider–Client relationship is active and the Case is explicitly associated with that Client.

### 6.3 Reviews

Provide queues for:

- Needs my review
- Unassigned
- Waiting for Provider
- Completed

Authorized administrators may assign reviews, request clarification, record HITL decisions and return Cases to the Provider.

### 6.4 Providers

Show connected Provider organizations, Provider Users and relationship status. Permit connection management and Client-scoped metrics. Never show the Provider's standalone Cases or Cases associated with another Client.

### 6.5 Rules

Show global Rules as read-only and Client-owned Rules as manageable. Before creating a Client Rule, display matching global Rules to encourage reuse.

### 6.6 Validation Schemes

Allow management of Client Schemes and use of applicable global Schemes.

### 6.7 Analytics

Recommended tabs: Cases, Providers, Documents, Validation, Rules, and Usage & Cost. All data is restricted to the Client tenant.

### 6.8 Account Center

Manage Provider organizations, Provider Users, invitations, suspensions, deactivations and notification preferences.

## 7. Provider User Navigation

Primary navigation:

1. Home
2. Cases
3. New Case
4. Connections
5. Notifications
6. Account

### 7.1 Home

Show primary actions, recent Cases, returned Cases requiring action and connection status. Do not expose Client administration or analytics.

### 7.2 Cases

Recommended views:

- All Cases
- My Cases
- Action required
- Validating
- Validated
- Shared with Client
- Completed
- Archived

Clearly distinguish standalone Cases from Client-connected Cases and show the Client name only when the Case is explicitly associated with that Client.

### 7.3 New Case

Open the guided Case creation flow defined below.

### 7.4 Connections

Show active, pending and suspended Client relationships. Providers may connect a standalone account to one or more Clients later.

### 7.5 Account

Allow profile, password, MFA and notification preference changes. Provider Users cannot delete or deactivate their own accounts.

## 8. Case Creation Flow

Use a step-based flow:

1. Case details
2. Insurer and Client
3. Validation Scheme
4. Documents
5. Review and validate

### Step 1 — Case Details

Capture Case type, patient reference, event date and optional external reference. Collect only the minimum personal information required.

### Step 2 — Insurer and Client

Display a recognized insurer when available, but explain that recognition does not share the Case. The Provider may select only an actively connected Client or continue independently.

### Step 3 — Validation Scheme

Show only Schemes the Provider is authorized to use. If no Scheme matches automatically, display:

> No Validation Scheme was selected automatically. Choose an available Client and Validation Scheme to continue.

The Provider may save the Case as a draft.

### Step 4 — Documents

Support drag and drop, file selection and mobile camera capture. Show upload progress, readability status, document type and split-review controls.

### Step 5 — Review and Validate

Show the selected Client, Scheme, Case details and documents before the primary action: **Start validation**.

## 9. Case Detail Page

The header shows Case reference, Case status, latest validation status, Provider, recognized insurer, associated Client and review assignee where authorized.

Use these tabs:

- Overview
- Documents
- Validation
- Review
- Activity

Hide Review when the Case has no Client review workflow.

### Overview

Show Case metadata, ownership, association, Scheme and next required action.

### Documents

Show a checklist, versions, document status and secure viewer. Only Provider Users can upload or replace documents.

### Validation

Show grouped results, recommendations and validation history.

### Review

Show Client review controls to authorized Client Admins. Providers may see requests and decisions, but not private internal notes.

### Activity

Show an authorized, audit-derived timeline without exposing sensitive security metadata.

## 10. Page Actions

Each page should have one clear primary action. Examples include **Create Case**, **Upload documents**, **Start validation**, **Submit for review**, **Request clarification** and **Publish Scheme**.

Use secondary actions for save draft, cancel, preview and download. Destructive actions require confirmation. Avoid generic labels such as Submit, Proceed or OK when a specific label is available.

## 11. Tables and Lists

All large lists require:

- Server-side pagination and page-size selection.
- Search, filters and sorting.
- Loading, empty and error states.
- Visible active filters and **Clear all**.
- Keyboard-accessible row navigation.
- Responsive presentation.

Pagination must show **Rows per page**, current range, total records, **Previous** and **Next**. Preserve search, filters and page position when returning from a detail page. Never fetch an entire dataset merely to paginate it in the browser.

## 12. Search and Filters

Search must remain within the current role and organization scope.

- Providers may search authorized Cases by Case reference, external reference and permitted patient fields.
- Client Admins may search Client-associated Cases by reference, Provider, external reference and status.
- Super Admins must not have Case search.

Reusable filters should cover status, date range, Provider, Client, Scheme, document type, validation outcome, review state and assignee where authorized.

## 13. Status Presentation

Always display status with text and an accessible visual indicator; never rely on color alone. Keep Case status, validation status, document status and HITL review status separate.

Example:

- Case: `In validation`
- Validation: `Action required`
- Documents: `2 missing`
- Review: `Not requested`

Each status area should identify the next available action.

## 14. Validation Result Presentation

Group results into:

- Action required
- Missing documents
- Failed checks
- Needs review
- Warnings
- Passed
- Not applicable
- Technical issues

For every result, show what was checked, why it received that result, the recommended next step and supporting evidence when permitted. Do not expose raw model prompts, internal JSON, stack traces or provider error messages.

## 15. Document Upload and Classification UI

The upload zone should say **Drag and drop documents here**, with **Choose files** and **Take photo** alternatives. Each file shows its name, size, upload progress, detected type, readability state and any isolated error.

When classification is confident, show:

> Identified as: [Document Type]

with **Confirm** and **Change type**.

When classification is unclear, show:

> We could not identify this document type. Choose a type to continue.

For multi-document scans, provide thumbnails and controls to split, merge, move, reorder, rotate, exclude and assign document types. Preserve the original uploaded file.

## 16. Notifications UI

Show unread state, category, priority, timestamp and a direct link to the relevant authorized page. Opening a notification must recheck authorization. Categories include Case action, validation complete, review request, clarification, account and system notices.

## 17. Account Center

Super Admin tabs:

- Client Admins
- Standalone Providers
- Invitations
- Suspended

Client Admin tabs:

- Providers
- Provider Users
- Invitations
- Suspended

Account statuses are `Invited`, `Active`, `Suspended` and `Deactivated`.

## 18. Rule and Scheme UI

Rule lists should show name, scope, version, status, applicability, owner and last update. Rule details use Definition, Applicability, Versions and Usage tabs.

The Scheme builder includes Scheme information, available and selected Rules, Rule ordering, parameters, HITL configuration, compiled preview and version controls. Display matching global Rules before allowing a Client Admin to create a duplicate Client Rule.

## 19. Empty, Loading and Error States

Examples:

- **No Cases yet. Create your first Case to begin.**
- **No documents uploaded. Add the required documents to validate this Case.**
- **No reviews need attention.**
- **No active Client connections. You can still validate documents independently.**
- **No Validation Scheme was selected automatically. Choose an available Client and Validation Scheme to continue.**

Use skeletons for initial loading and inline progress for uploads, extraction and validation. Load dashboard modules independently and disable duplicate actions while a request is running.

Errors must explain what failed and what the user can do next without exposing internal implementation details.

## 20. Confirmation Dialogs

Require explicit confirmation for:

- Sharing or submitting a Case to a Client.
- Changing a Scheme after validation has started.
- Replacing a document version.
- Archiving, cancelling, rejecting or liquidating a Case.
- Suspending or deactivating an account.
- Publishing or archiving a Rule or Scheme.

## 21. Accessibility

- Support complete keyboard operation and visible focus states.
- Associate labels, instructions and errors with form controls.
- Use logical heading order and accessible dialog focus management.
- Do not use color as the only status signal.
- Meet appropriate color contrast and touch-target requirements.
- Provide text labels for icon-only actions.
- Make the document viewer and split-review flow keyboard accessible.

## 22. Navigation Security

- Enforce route authorization and backend permissions independently.
- Block direct URL access to unauthorized screens.
- Recheck access when opening deep links and notifications.
- Use an appropriate `403` page for authenticated but unauthorized access and `404` where revealing the resource would leak information.
- Clear sensitive client-side caches on sign-out or account-context change.

## 23. Suggested URL Structure

### Super Admin

- `/super-admin/overview`
- `/super-admin/clients`
- `/super-admin/rules`
- `/super-admin/schemes`
- `/super-admin/accounts`
- `/super-admin/providers`
- `/super-admin/usage`

### Client Admin

- `/admin/overview`
- `/admin/cases`
- `/admin/cases/{caseId}`
- `/admin/reviews`
- `/admin/providers`
- `/admin/rules`
- `/admin/schemes`
- `/admin/analytics`
- `/admin/accounts`
- `/admin/notifications`

### Provider User

- `/provider/home`
- `/provider/cases`
- `/provider/cases/new`
- `/provider/cases/{caseId}`
- `/provider/connections`
- `/provider/notifications`
- `/provider/account`

## 24. Breadcrumbs and Unsaved Changes

Use breadcrumbs on nested pages, for example:

- `Cases / CASE-2026-00124 / Validation`
- `Rules / Medical Report Requirement / Version 3`
- `Providers / City Hospital / Users`

Warn before navigation when there are unsaved Case changes, Rule or Scheme edits, account changes, HITL decisions, type assignments or split-review changes.

## 25. Design Consistency

Use shared components for buttons, inputs, selectors, tables, pagination, status badges, notifications, dialogs, upload zones, document cards, validation results, and loading, empty and error states.

Use domain terms consistently. A Client is the tenant organization receiving explicitly shared Cases; do not use *insurer* as a synonym for access rights. A Validation Scheme is a configured collection of Rules; do not call it a policy.

## 26. Required Tests

- Each role sees only its permitted navigation.
- Unauthorized direct URLs and APIs are blocked.
- Super Admin cannot reach Cases or documents.
- Client Admin cannot see standalone Cases or Cases associated with another Client.
- Recognizing an insurer or Client name does not expose the Case.
- Provider views clearly distinguish standalone and Client-connected Cases.
- Client selection lists only active Provider connections.
- Scheme selection lists only authorized Schemes.
- Upload and camera capture work on supported mobile layouts.
- Unclear document types require Provider confirmation.
- Split review supports keyboard operation.
- Large lists use server-side pagination and preserve filters.
- Statuses remain understandable without color.
- Loading and error states operate independently.
- Destructive actions require confirmation.
- Notification links recheck authorization.

## 27. Required Claude Code Implementation Output

When implementing this segment:

1. Inspect existing routes, layouts and reusable components before changing code.
2. Identify and resolve conflicts with Segments 1–11.
3. Implement the role-specific information architecture and navigation.
4. Add frontend route guards and corresponding backend authorization.
5. Build the shared responsive shell, Case creation flow and Case detail structure.
6. Implement reusable tables, filters, pagination, statuses, dialogs and page states.
7. Apply accessibility requirements throughout.
8. Add automated tests for the permissions and interactions listed above.

## 28. Compact Navigation Summary

| Role | Primary navigation |
|---|---|
| Super Admin | Clients, Global Rules, Global Schemes, Accounts, Standalone Providers and Usage |
| Client Admin | Overview, Cases, Reviews, Providers, Rules, Schemes, Analytics and Account Center |
| Provider User | Home, Cases, New Case, Connections, Notifications and Account |
