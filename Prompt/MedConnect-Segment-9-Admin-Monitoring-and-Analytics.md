# MedConnect — Segment 9: Admin Monitoring and Analytics

## Purpose

Define how Client Admins monitor Cases, Provider activity, validation performance, Client review workload and processing efficiency.

The Admin experience must answer:

- Which Cases need attention now?
- Which Providers are waiting for a Client response?
- Where do Cases become blocked?
- Which documents and rules cause issues?
- How much HITL is required?
- How reliable is automated classification, extraction and validation?
- How much AI is used and what does it cost?
- What happens after validation and submission?

Monitoring shows current operational state. Analytics shows aggregate trends during a selected period.

## 1. Access Boundaries

### Client Admin

Can monitor and analyze:

- all Cases explicitly associated with their Client
- connected Providers that shared Cases with their Client
- all Case statuses
- Client-owned and applied global Schemes
- validation results
- Client HITL tasks
- document requests
- Client decisions
- AI usage and cost attributable to their Client

Cannot access standalone Cases, another Client’s Cases, unrelated Providers, unshared documents or results, another Client’s rules and costs or platform-wide Super Admin analytics.

Recognizing the Client’s insurer on a standalone Case never makes the Case available.

### Super Admin

May see aggregate platform counts, document-processing volume, rule usage, token and cost metrics, failure rates, engine performance, Client-level aggregate usage and global-rule adoption.

Cannot open Cases, view Case references, documents, extracted values, patient data or Provider User activity tied to identifiable Cases.

### Provider User

Does not access the Client Admin dashboard. Provider tasks and Case history belong to a separate Provider view.

## 2. Monitoring vs Analytics

Monitoring metrics are current snapshots, such as Cases awaiting review or Providers.

Analytics metrics are event or outcome measurements during a selected period, such as validations completed or review tasks resolved.

Never mix snapshot and period metrics without labels.

## 3. Navigation

```text
Overview
Cases
Reviews
Providers
Documents
Validation
Rules
Usage & Cost
```

- Overview combines essential indicators and trends.
- Cases contains lists, status distribution and age.
- Reviews contains HITL and document requests.
- Providers contains Client-scoped Provider aggregates.
- Documents contains upload quality and missing-document patterns.
- Validation contains outcomes, corrections and revalidation.
- Rules contains rule usage, failure and review rates.
- Usage & Cost contains AI calls, tokens, cache and estimates.

## 4. Filters

```ts
DashboardFilters {
  date_from
  date_to
  provider_ids
  insurer_ids
  case_statuses
  validation_results
  scheme_ids
  rule_ids
  document_type_codes
  case_modes
  review_statuses
  case_source
}
```

Always scope filters to the authenticated Client. Reject or ignore unauthorized Client IDs from the browser.

Default: `Last 30 days`.

Options: Today, Last 7 days, Last 30 days, Last 90 days and Custom.

## 5. Date Semantics

Every metric defines its timestamp:

- Cases created → `case.created_at`
- Cases submitted → `submission.submitted_at`
- Validation completed → `validation_run.completed_at`
- HITL completed → `hitl_task.resolved_at`
- Accepted → `case.accepted_at`
- Rejected → rejection-transition time
- Liquidated → `case.liquidated_at`
- Model usage → `model_usage.created_at`

Store UTC and apply Client timezone to day and week boundaries.

## 6. Overview KPIs

```text
Open Cases
Provider Action
Client Review
Validated Cases
Submitted Cases
Accepted Cases
Rejected Cases
Liquidated Cases
Average Client Review Time
```

### Open Cases

Current Client-associated Cases not accepted, rejected, liquidated, closed, cancelled or archived.

### Provider Action

Current Cases with `provider_action_required`.

### Client Review

Current Cases with `client_review_required`.

### Validated Cases

Cases whose current Validation Run completed in the period with `passed` or `passed_with_warnings`.

### Submitted, Accepted, Rejected and Liquidated

Count corresponding transition events during the selected period.

Liquidation is explicit and never inferred from validation success.

### Average Client Review Time

Average from HITL task creation to resolution for tasks resolved during the period.

## 7. Operational Queues

```text
Needs my review
Waiting for Provider
Processing errors
Recently returned
Approaching SLA
```

Review queue shows Case reference, Provider, reason, rule/conflict, age, priority, assignee and latest Provider activity.

Waiting queue shows requested action, request date, time waiting, reminders and last activity.

Processing errors remain separate from failed validation outcomes.

SLA values are configurable and never hard-coded.

## 8. Case List

Columns:

```text
Case reference
Provider
Recognized insurer
Validation Scheme
Case status
Latest validation result
Next action
Assigned reviewer
Created
Updated
Time in status
```

Optional: external reference, submission date, decision date, liquidation date and source.

Support sorting, filtering, search, pagination, authorized export and Case detail.

Exclude standalone Cases and never authorize from `insurer_id`.

## 9. Status Distribution and Flow

Show current Case count by lifecycle status as a snapshot. Clicking a status filters the authorized list.

Show period milestone movement:

```text
Created
→ Validation started
→ Validated
→ Submitted
→ Accepted or Rejected
→ Liquidated or Closed
```

Count distinct Cases reaching each milestone. A Case may appear at several stages.

Stage conversion:

```text
Cases reaching next stage / Cases reaching previous stage
```

Do not call it a strict funnel unless denominators are explicit.

## 10. Case Age

Buckets:

```text
Less than 24 hours
1–3 days
3–7 days
7–14 days
14–30 days
More than 30 days
```

Case age is current time minus creation. Time in status is current time minus latest transition. Allow authorized drill-down.

## 11. HITL Analytics

Track open, assigned, unassigned, waiting and completed tasks, average and median review time, overdue tasks, override rate, confirmation rate and document-request rate.

```text
Override rate = override decisions / completed HITL decisions
Confirmation rate = confirmations / completed HITL decisions
```

Do not interpret high override rate automatically as poor performance.

## 12. Provider Analytics

Client-scoped columns:

```text
Provider
Cases created
Cases submitted
Validated without blocking issues
Returned Cases
Missing-document rate
Average Provider response time
Accepted Cases
Rejected Cases
Liquidated Cases
Last activity
```

Exclude standalone Cases and Cases for other Clients.

Provider response time is Client request to Provider response for requests completed during the period.

Missing-document rate is Cases with a missing required document divided by Cases validated during the period.

Show minimum sample-size warnings and do not label Providers from small samples.

## 13. Document Analytics

Track uploads, pages, documents per Case, unreadable and partially readable rates, classification confirmation/correction, combined scans, split corrections, replacements, missing requirements by type and processing duration.

```text
Unreadable rate = unreadable Document Versions / processed Document Versions
Classification correction rate = changed machine suggestions / confirmed suggestions
Split correction rate = changed proposed splits / reviewed proposed splits
```

## 14. Validation Analytics

Track runs started, completed, partially completed and failed, overall results, first-pass rate, Provider correction rate, revalidation count, deterministic and AI shares, cache rate, validation duration and issues by category, Scheme and Provider.

```text
First-pass rate = Cases whose first completed run passed / Cases with a completed first run
```

Default: `passed` and `passed_with_warnings` count as first-pass success.

```text
Provider correction rate = runs with Provider-corrected fields / completed runs
```

## 15. Rule Analytics

Show Rule, scope, owner, version, Schemes using it, execution count, pass, fail, review, skipped and technical-error rates, correction association, Client override rate, average tokens and cost.

Preserve Rule-version boundaries.

Use insights to find rules causing excessive action, HITL, overrides or token cost and AI rules suitable for deterministic replacement.

Never change rules automatically from analytics.

## 16. Scheme Analytics

Show Cases, completed validations, first-pass rate, missing documents, Provider corrections, HITL rate, validation duration, AI calls, tokens and cost per Case plus acceptance, rejection and liquidation where applicable.

Allow Scheme-version filtering.

## 17. Usage and Cost Model

```ts
ModelUsage {
  client_id
  provider_id
  case_id
  scheme_version_id
  rule_version_ids
  document_version_id
  task
  model_provider
  model_name
  prompt_tokens
  completion_tokens
  estimated_cost_minor
  currency
  cache_hit
  retry_number
  duration_ms
  created_at
}
```

Do not store prompts, document text or extracted values.

Client Admin sees their Client only. Super Admin sees aggregates without Case drill-down.

## 18. Usage KPIs

```text
Total AI Calls
Total Tokens
Estimated Cost
Cost per Case
Cost per Completed Validation
Cache Hit Rate
AI Calls per Case
Deterministic Rule Share
```

```text
Cost per Case = processing cost / Cases with processing activity
Cost per completed validation = processing cost / Cases with completed runs
Cache hit rate = cached operations / cache-eligible operations
```

Exclude deterministic operations from token totals.

## 19. Cost Alerts

Future configuration may include daily token, monthly cost, Case token, high-cost Case and abnormal retry thresholds.

For v1, threshold configuration may be Super Admin-only. Alerts contain no Case content.

## 20. Processing Performance

Track upload-to-preview, OCR, classification, extraction, validation, queue time, failure, retry, timeout and superseded-job rates.

Separate queue time, execution time, Provider waiting and Client waiting. Never report human waiting as system processing.

## 21. Period Comparison

Optionally compare with the immediately preceding equal-length period.

```text
Trend = (current - previous) / previous
```

When previous is zero show `No previous-period comparison` rather than infinity.

## 22. Drill-down

Drill-down preserves filters, rechecks backend authorization, returns only associated Cases, excludes standalone Cases and explains inclusion logic.

Super Admin aggregate metrics never drill to Case data.

## 23. Exports

Allow authorized CSV and XLSX exports with active filters, Client timezone, generation timestamp and metric definitions.

Exclude inaccessible data, document content and extracted values unless a separate authorized export exists.

Audit exports and run large exports asynchronously.

## 24. Data Freshness

Show `Last updated: {timestamp}`.

- Operational queues and Case lists: near real time.
- Aggregate analytics: scheduled aggregation allowed.
- Cost: available after usage ingestion.

Label materially different freshness.

## 25. Empty, Loading and Error States

```text
No Cases match the selected filters.
No Cases currently require Client review.
No connected Providers have shared Cases during this period.
No AI processing usage was recorded during this period.
No results are available for the selected Rule and period.
```

Dashboard sections load independently. A failed section must not block the page.

```text
This section could not be loaded. Try again.
```

Do not expose infrastructure errors.

## 26. Privacy

Never expose patient or policyholder names, document text, extracted medical values, unrestricted notes, raw prompts or permanent storage links in analytics.

Case lists may show authorized references and operational metadata but only minimum necessary data.

## 27. Aggregation and Performance

Do not scan all operational tables on every dashboard load.

Use indexed operational queries, daily aggregate facts, materialized views where appropriate, incremental aggregation, cached responses and asynchronous exports.

```ts
AnalyticsDailyFact {
  date
  client_id
  provider_id
  insurer_id
  scheme_version_id
  rule_version_id
  document_type_code
  metric_name
  metric_value
}
```

No PII in aggregate facts.

## 28. Event Standards

Use `noun_verb`, for example `case_created`, `validation_completed`, `hitl_resolved`, `model_usage_recorded` and `case_liquidated`.

Events contain environment, timestamp, safe identifiers, authorized Client dimension and event version without filenames, content, patient information or extracted values.

## 29. Metric Governance

```ts
MetricDefinition {
  code
  name
  description
  numerator
  denominator
  inclusion_rules
  exclusion_rules
  timestamp_field
  aggregation
  timezone
  owner
  version
}
```

Never implement a metric from its label alone. Version definition changes with effective dates.

## 30. Audit Events

```ts
admin_dashboard_opened
case_list_exported
analytics_exported
usage_viewed
cost_viewed
provider_metrics_viewed
rule_metrics_viewed
```

Export audit includes actor, Client, filters, format, timestamp and row count without exported content.

## 31. Required Tests

Prove that:

- Client Admin sees only associated Cases
- standalone Cases never appear
- recognized insurer does not grant access
- all associated statuses appear
- monitoring uses snapshots
- analytics uses documented timestamps
- drill-down preserves filters and authorization
- Super Admin aggregates cannot open Cases
- Provider metrics exclude other Clients and standalone Cases
- Rule analytics preserves versions
- processing errors differ from validation failures
- human waiting differs from processing time
- deterministic operations do not appear in token totals
- zero comparisons are safe
- sections fail independently
- exports apply authorization and filters
- analytics, logs and audits contain no PII

## 32. Required Implementation Output

Before implementing:

1. Inspect Case, status, Validation Run, HITL, document, rule and usage data.
2. Define monitoring separately from period analytics.
3. Create versioned metric definitions.
4. Propose indexes, aggregate tables and materialized views.
5. Define Client Admin and Super Admin contracts.
6. Define KPI and chart drill-down queries.
7. Implement backend authorization before UI.
8. Implement timezone-consistent filtering.
9. Implement asynchronous exports.
10. Add metric, authorization, aggregation and privacy tests.

## Recommended Overview

- Open Cases
- Provider Action
- Client Review
- Validated Cases
- Average Client Review Time
- Cases by status
- Cases needing attention
- Cases waiting for Provider
- Validation results over time
- Top document issues
- HITL outcomes
- AI usage and estimated cost

Keep deeper Provider, Rule, Scheme and document-quality analytics in dedicated tabs.

