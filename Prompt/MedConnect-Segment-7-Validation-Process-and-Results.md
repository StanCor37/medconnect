# MedConnect — Segment 7: Validation Process and Results

## Purpose

Define how MedConnect executes a Validation Scheme against Case documents, combines individual rule outcomes and presents actionable results to Provider Users and Client Admins.

Clearly distinguish complete information, missing requirements, failed checks, unclear conclusions, technical failures and human decisions.

A successful validation does not guarantee payment or final acceptance by an insurer or Assistance Company.

## 1. Core Principles

- Validate against one pinned Validation Scheme version.
- Pin every Validation Rule version used.
- Reuse structured extraction from Segment 6.
- Never extract the same information again during validation.
- Run deterministic rules before AI-assisted rules.
- Skip AI when deterministic conditions decide the result.
- Preserve every automated outcome.
- Store human decisions separately.
- Distinguish missing information from failed validation.
- Distinguish unclear results from technical errors.
- Show Provider Users actionable recommendations.
- Create Client HITL only for Client-connected Cases.
- Never expose standalone Cases to a recognized insurer or Client.
- Revalidate only affected rules after changes.
- Preserve completed Validation Runs immutably.

## 2. Validation Run

A Validation Run is one immutable execution against exact input versions.

```ts
ValidationRun {
  id
  case_id
  scheme_version_id
  status
  overall_result
  started_by_user_id
  trigger
  started_at
  completed_at
  input_snapshot_hash
  compiled_plan_version
  supersedes_validation_run_id
  superseded_by_validation_run_id
}
```

Pin Case version, Scheme version, Rule versions, Document Versions, confirmed types, extracted and confirmed values, parameters, engine versions, AI model and prompt versions and timestamp.

Never modify a completed run.

## 3. Run Status

```ts
validation_run_status:
  "queued" |
  "processing" |
  "waiting_for_provider" |
  "waiting_for_client_review" |
  "completed" |
  "partially_completed" |
  "failed" |
  "cancelled" |
  "superseded"
```

- `waiting_for_provider`: document type, field, split, missing document or replacement requires Provider action.
- `waiting_for_client_review`: Client HITL is open.
- `partially_completed`: some rules completed while others lacked inputs or encountered technical errors.
- `failed`: the run produced no reliable overall result.
- `superseded`: newer inputs produced a newer run.

## 4. Trigger

Provider Users may validate when a published Scheme is selected, required existing Document Types are confirmed and no required split confirmation remains.

```ts
validation_trigger:
  "provider_started" |
  "automatic_after_upload" |
  "automatic_after_confirmation" |
  "provider_revalidated" |
  "client_requested_revalidation" |
  "system_retry"
```

Automatic validation may be configurable but must not duplicate a run for the same input snapshot.

## 5. Pre-validation Checks

Before execution:

1. Verify authorization.
2. Verify the Case is active.
3. Verify Scheme availability.
4. Verify the compiled Scheme plan.
5. Resolve current Document Versions.
6. Resolve confirmed types.
7. Resolve extracted and confirmed fields.
8. Calculate the input snapshot hash.
9. Reuse an identical completed result where allowed.
10. Determine which rules run, wait or skip.

Do not call AI for these checks.

## 6. Execution Order

1. Required-document checks.
2. Readability requirements.
3. Required-field checks.
4. Deterministic consistency checks.
5. Deterministic date and amount checks.
6. Deterministic eligibility rules.
7. AI applicability gates.
8. AI-assisted rules using targeted evidence.
9. Conflict detection.
10. HITL routing.
11. Recommendation mapping.
12. Deterministic overall-result calculation.

Missing prerequisites short-circuit only dependent rules. Continue independent checks so users receive one useful consolidated result.

## 7. Rule Outcomes

```ts
rule_outcome:
  "pass" |
  "fail" |
  "needs_review" |
  "skipped" |
  "not_executed" |
  "processing_error"
```

- `pass`: condition satisfied.
- `fail`: rule ran successfully and condition was not satisfied.
- `needs_review`: evidence exists but human judgment is required.
- `skipped`: rule does not apply.
- `not_executed`: required input is unavailable or unresolved.
- `processing_error`: a technical problem prevented execution.

Never use `fail` for missing documents, absent fields or infrastructure errors.

## 8. Rule Result Model

```ts
ValidationRuleResult {
  id
  validation_run_id
  case_id
  rule_version_id
  outcome
  severity
  reason_code
  recommendation_code
  input_references
  evidence_references
  confidence
  execution_type
  execution_engine
  execution_engine_version
  started_at
  completed_at
  cached
  superseded
}
```

Every result references exact inputs.

## 9. Requirement Results

Represent completeness separately from insurance-rule outcomes.

```ts
RequirementResult {
  id
  validation_run_id
  requirement_type
  document_type_code
  field_definition_id
  status
  reason_code
  recommendation_code
}
```

```ts
requirement_type:
  "document" |
  "field" |
  "readability" |
  "classification" |
  "split_confirmation"
```

```ts
requirement_status:
  "satisfied" |
  "missing" |
  "unreadable" |
  "unconfirmed" |
  "invalid"
```

Example: a missing medical report is a missing requirement. A medical-event date outside the policy period is a failed rule.

## 10. Overall Result

Calculate deterministically:

```ts
overall_validation_result:
  "passed" |
  "passed_with_warnings" |
  "issues_found" |
  "needs_provider_action" |
  "needs_client_review" |
  "incomplete" |
  "processing_failed"
```

- `passed`: all blocking requirements and rules pass with no unresolved review.
- `passed_with_warnings`: blocking checks pass and non-blocking warnings remain.
- `issues_found`: at least one applicable blocking rule fails.
- `needs_provider_action`: Provider confirmation, correction, classification or replacement is needed.
- `needs_client_review`: Client-connected Case requires HITL.
- `incomplete`: required documents or fields are missing or unreadable.
- `processing_failed`: technical failure prevents a reliable result.

Never use an LLM to calculate the overall result.

## 11. Severity

```ts
severity: "info" | "warning" | "blocking"
```

- Info provides context.
- Warning may produce `passed_with_warnings`.
- Blocking prevents `passed` until resolved or reviewed.

Severity comes from the pinned Rule version and cannot change silently.

## 12. Results Presentation

Order:

1. Actions required.
2. Missing or unreadable documents.
3. Failed checks.
4. Items requiring review.
5. Warnings.
6. Passed checks.
7. Skipped checks.
8. Technical errors.

Example summary:

```text
Validation result

3 actions required
2 missing items
1 check needs review
12 checks passed
```

Groups:

```text
Action required
Missing documents
Needs review
Warnings
Passed
Not applicable
Technical issues
```

Do not expose raw engine output.

## 13. Result Detail and Evidence

Show rule or requirement name, result, severity, short explanation, recommendation, related Document and field, evidence link, review requirement and automated or reviewed state.

Do not expose prompts, raw JSON, exceptions or confidential rule notes.

Selecting a result opens the supporting Document and highlights relevant evidence. Show all sources when several were used.

Evidence access requires authorization to the underlying Case and Document.

## 14. Recommendations

Use application templates referenced by `recommendation_code`.

```ts
"upload_medical_report"
"upload_clearer_invoice"
"confirm_document_type"
"review_patient_name"
"review_event_date"
"confirm_policy_period"
"request_client_review"
"contact_insurer"
```

Do not call AI for routine recommendations.

## 15. Provider Actions

Provider Users can upload a missing document or replacement, choose a type, confirm or correct extracted values, inspect evidence, rerun affected checks and request Client review for a connected Case.

Provider Users cannot override a blocking rule to `pass`. A correction changes an input and creates revalidation. It never edits the previous result.

## 16. Standalone Results

Standalone Provider Users see completeness, extraction issues, deterministic results, applicable global-rule results, warnings, recommendations and unresolved items requiring external confirmation.

They do not receive Client-owned results, Client HITL, approval, rejection or internal Client notes.

When external review is needed show:

```text
This result requires confirmation from the relevant Assistance Company or insurer.
```

Do not create hidden Client tasks and do not expose the Case to a recognized insurer.

## 17. Client-connected Results

Client Admin can see shared documents, requirement and automated results, Provider corrections, evidence, pending HITL tasks, run history and human decisions.

Client Admin can confirm unclear results, override with a reason, request documents, return the Case, request revalidation and resolve conflicts.

Client Admin cannot modify the stored automated result.

## 18. HITL Tasks

Create HITL when a rule returns `needs_review`, HITL policy requires it, rules conflict, high-risk values conflict, Provider requests review or configured confidence is low.

```ts
HitlTask {
  id
  case_id
  validation_run_id
  rule_result_id
  assigned_client_id
  status
  reason_code
  created_at
  resolved_at
  resolved_by_user_id
}
```

```ts
hitl_status:
  "open" |
  "in_review" |
  "waiting_for_provider" |
  "resolved" |
  "cancelled" |
  "superseded"
```

## 19. HITL Decision

```ts
HitlDecision {
  id
  hitl_task_id
  automated_outcome
  decision
  reason_code
  reason
  decided_by_user_id
  decided_at
}
```

```ts
hitl_decision:
  "confirm" |
  "override_to_pass" |
  "override_to_fail" |
  "request_documents" |
  "return_to_provider"
```

Every override requires a reason. Show automated outcome, human decision, reviewer, timestamp and reason separately.

## 20. Conflicts

When rules conflict, preserve both results, identify versions and prevent automatic resolution.

For a connected Case set `needs_client_review`. For a standalone Case show an external-confirmation recommendation.

Rule ownership does not resolve conflict unless the Scheme defines precedence.

## 21. Revalidation

Revalidate after a new Document Version, type change, corrected field, newly uploaded requirement, Client request, explicit Scheme change or successful retry.

Create a new immutable Validation Run. Never rewrite a completed run.

```ts
ValidationDependency {
  rule_version_id
  document_type_codes
  document_version_ids
  field_definition_ids
  case_field_paths
}
```

When input changes:

1. Calculate a new snapshot.
2. Supersede affected current-view results while preserving history.
3. Reuse unaffected valid results.
4. Run only affected requirements and rules.
5. Call AI only for affected applicable AI rules.
6. Recalculate overall result deterministically.

## 22. Validation History

Authorized users can view runs newest first, including run number, time, trigger, Scheme version, result, changed inputs, counts and current or superseded state.

Allow comparison between runs.

```text
Run 3 — Current
Medical report replaced
2 previous issues resolved
1 issue remains
```

Do not expose historical standalone runs to a Client unless the Case was explicitly shared and product rules allow inclusion.

## 23. Result Snapshot

```ts
ValidationResultSnapshot {
  validation_run_id
  scheme_version_id
  overall_result
  requirement_summary
  rule_summary
  hitl_summary
  document_version_ids
  generated_at
}
```

Future reports and PDFs derive from this snapshot. Do not use an LLM to rewrite the complete result for export.

## 24. Technical Failures and Retries

Technical errors are not failed rules.

```ts
"rule_engine_error"
"model_timeout"
"invalid_model_output"
"evidence_unavailable"
"dependency_unavailable"
"budget_exceeded"
"processing_job_failed"
```

Show:

```text
This check could not be completed. Retry it or review the information manually.
```

Retries are idempotent, preserve attempts, use the same snapshot, stop at configured limits, avoid successful unrelated rules and respect token budgets.

Changed inputs require revalidation rather than a technical retry.

## 25. Result Caching

```ts
ValidationResultCacheKey =
  rule_version_id +
  resolved_parameters_hash +
  normalized_input_hash +
  execution_engine_version
```

Reuse only for exact matching versions, parameters and inputs with safe isolation. Never cache by Case ID alone.

## 26. Concurrent Review

Use optimistic concurrency for corrections and HITL decisions.

Reject stale updates, preserve the accepted decision and require reload. One HITL task has only one active final decision.

## 27. Validation Status vs Case Status

Validation Run status and Case lifecycle status are separate.

A Case may await documents while its latest run is partially completed or need review while its run waits for Client review.

Do not derive the complete Case lifecycle directly from `overall_validation_result`. Mapping is defined in the Case lifecycle segment.

## 28. Notifications

Potential notifications include Provider action required, missing documents, correction required, Client review requested, Case returned, review completed, validation completed and processing failed.

Do not include medical data, values or document content in notification subjects.

## 29. Security and Privacy

- Recheck authorization for every result and evidence request.
- Prevent Super Admin access to Case-level results.
- Prevent Client access to standalone results.
- Never grant access from recognized `insurer_id`.
- Enforce isolation in background jobs.
- Keep PII out of logs, analytics and audit payloads.
- Do not expose internal prompts or confidential Client-rule wording.
- Preserve model, prompt and Rule versions without unrestricted prompt storage.
- Never use validation data for training without separate authorization.

## 30. Usage and Quality Metrics

Track runs started and completed, overall-result distribution, rule outcomes, missing rates, Provider correction rate, Client override rate, HITL rate, waiting times, revalidation count, cache rate, deterministic-to-AI ratio, AI calls, tokens, cost and processing-error rate.

Metrics contain no PII.

## 31. Audit Events

```ts
validation_started
validation_completed
validation_partially_completed
validation_failed
validation_superseded
rule_executed
rule_result_reused
provider_action_requested
provider_value_corrected
client_review_requested
hitl_started
hitl_resolved
hitl_overridden
additional_documents_requested
revalidation_started
```

Audit safe identifiers, statuses, versions, actor, timestamps and reason codes without patient data, content or medical values.

## 32. Required Tests

Prove that:

- runs pin exact Scheme, Rule, Document and input versions
- deterministic rules precede AI
- missing requirements are not failed rules
- technical failures are not insurance failures
- overall result is deterministic
- independent rules continue after unrelated failure
- AI runs only after applicability gates
- Provider correction creates new input state
- automated and human outcomes remain separate
- standalone Cases never create Client HITL
- recognized insurers never receive standalone results
- Client HITL requires Client association and active relationship
- overrides require reasons
- changed inputs rerun only dependent rules
- unchanged results are reused safely
- completed runs remain immutable
- stale decisions cannot overwrite current decisions
- token and retry limits are enforced
- PII is absent from logs, analytics and audit payloads

## 33. Required Implementation Output

Before implementing:

1. Inspect Validation Scheme, Rule, Case, Document, extraction and HITL models.
2. Propose Validation Run, Rule Result, Requirement Result, HITL Task and snapshot schemas.
3. Define deterministic overall-result calculation.
4. Define dependencies and selective revalidation.
5. Define Provider and Client result views.
6. Implement standalone recommendations separately from Client HITL.
7. Preserve automated and human results independently.
8. Implement immutable run history.
9. Implement caching, retries and token-budget enforcement.
10. Add authorization, calculation, HITL, history and privacy tests.

## Key Distinctions

```text
Missing information ≠ failed rule
Unclear result ≠ technical failure
Successful validation ≠ guaranteed insurer approval
Automated outcome ≠ human decision
```

