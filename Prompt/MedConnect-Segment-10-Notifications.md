# MedConnect — Segment 10: Notifications

## Purpose

Define how MedConnect informs Provider Users and Client Admins about Case actions and outcomes.

External-system integrations, APIs and webhooks are out of scope.

Supported channels:

```ts
notification_channel: "in_app" | "email"
```

## 1. Core Rules

- In-app notifications are the primary notification record.
- Email contains minimal operational information and links to MedConnect.
- Notify only users authorized to access the related Case.
- A Client receives notifications only for Cases explicitly associated with it.
- Recognizing an insurer does not authorize Client notifications.
- Standalone Cases never notify Client Admins.
- Do not include patient data, medical information, document content or extracted values in subjects or notification payloads.
- Opening a notification revalidates Case access.
- Do not use AI to create routine text or select recipients.

## 2. Recipients

### Provider User

Provider notifications may go to the assigned Provider User, Case creator and authorized Provider colleagues where configured.

### Client Admin

Client notifications may go to the assigned reviewer and Client Admins subscribed to the relevant queue.

Client notifications require:

```ts
case.client_id === recipient.client_id
```

### Super Admin

Super Admin receives no Case notifications. Platform-operational notifications must contain no Case data or PII.

## 3. Events

### Provider-facing

```ts
document_upload_failed
document_type_confirmation_required
document_split_confirmation_required
document_unreadable
extracted_field_review_required
missing_document_required
provider_action_required
validation_completed
validation_completed_with_issues
case_returned_to_provider
case_accepted
case_rejected
case_liquidated
provider_client_connection_requested
provider_client_connection_activated
```

### Client-facing

```ts
case_shared_with_client
case_submitted_to_client
client_review_required
provider_documents_updated
provider_response_submitted
case_resubmitted
```

Do not notify users for every background-processing step.

## 4. Notification Model

```ts
Notification {
  id
  recipient_user_id
  recipient_organization_id
  type
  channel
  status
  priority
  case_id
  task_id
  client_id
  provider_id
  title_code
  message_code
  template_parameters
  created_at
  read_at
  sent_at
  failed_at
  failure_code
}
```

```ts
notification_status:
  "pending" |
  "sent" |
  "delivered" |
  "read" |
  "failed" |
  "cancelled"
```

```ts
notification_priority: "normal" | "high" | "urgent"
```

Do not store unrestricted Case or medical text in template parameters.

## 5. In-app Notifications

Provide unread count, notification list, pagination, mark as read, mark all as read, priority, timestamp and a direct Case or task link.

Revalidate authorization when opening.

If access was removed show:

```text
This Case is no longer available to your account.
```

Do not expose Case details.

## 6. Email

Use email for important actions and outcomes:

- Provider action required
- Client review required
- Case returned
- Case accepted
- Case rejected
- Case liquidated
- account invitation
- password reset

Email subjects must not contain patient name, diagnosis, policy number, Document Type or medical service.

Recommended subject:

```text
Action required for MedConnect Case {internal reference}
```

Email may contain internal reference, organization name, action category, due date and secure MedConnect link.

Do not attach Case documents.

## 7. Preferences

```ts
NotificationPreference {
  user_id
  event_category
  in_app_enabled
  email_enabled
  digest_frequency
}
```

```ts
digest_frequency:
  "immediate" |
  "daily" |
  "weekly" |
  "disabled"
```

Account and security notifications cannot be disabled. Important actions always create an in-app notification.

## 8. Deduplication and Reminders

Do not repeatedly notify unchanged state.

```ts
notification_deduplication_key =
  recipient_user_id +
  event_type +
  case_id +
  task_id +
  input_version
```

- Send once when a HITL task opens.
- Do not notify for each processing retry.
- Notify again only when required action materially changes.
- Stop reminders when a task resolves, cancels or is superseded.
- Configure reminder intervals and limits rather than hard-coding them.

## 9. Templates

```ts
NotificationTemplate {
  code
  channel
  locale
  subject_template
  body_template
  version
  active
}
```

Product language is English for v1.

Use predefined parameters and reject unknown parameters. Do not use AI for routine messages.

## 10. Failure Handling

Notification failure must not change Case status, validation results or HITL tasks.

If email fails:

- preserve the in-app notification
- record the failure
- retry within configured limits
- do not fall back to an insecure channel
- do not create duplicate notifications

## 11. Audit Events

```ts
notification_created
notification_sent
notification_failed
notification_read
email_sent
email_failed
```

Audit safe identifiers, type, channel, status and timestamp without content, patient data, medical information or extracted values.

## 12. Required Tests

Prove that:

- standalone Cases never notify Client Admins
- recognized insurer never authorizes notifications
- Provider notifications go only to authorized Provider Users
- Client notifications go only to the associated Client
- Super Admin receives no Case notifications
- opening a notification revalidates access
- email subjects contain no sensitive data
- email sends no document attachments
- deduplication prevents repeated notifications
- reminders stop after resolution
- notification failure does not change Case state
- audit and logs contain no PII

## 13. Required Implementation Output

Before implementing:

1. Inspect existing notification and email functionality.
2. Define events and recipient rules.
3. Define templates and permitted parameters.
4. Implement in-app notifications.
5. Implement secure email notifications.
6. Implement preferences, deduplication and reminders.
7. Enforce authorization when creating and opening notifications.
8. Add authorization, privacy and failure tests.

## Out of Scope

- external APIs
- API keys
- webhooks
- external status synchronization
- system-to-system document exchange
- third-party integration delivery logs

