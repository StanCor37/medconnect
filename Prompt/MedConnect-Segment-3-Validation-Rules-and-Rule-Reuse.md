# MedConnect — Segment 3: Validation Rules and Rule Reuse

## Purpose

Define how Validation Rules are created, reused, configured, versioned and executed while minimizing LLM calls and token consumption.

Validation Rules determine:

- which documents are expected
- which fields are extracted
- how structured information is compared
- which policy or insurer conditions apply
- when human review is required
- which recommendations are shown to the Provider User

Validation results and recommendations do not guarantee that an insurer or Assistance Company will accept or pay a Case.

## 1. Core Concepts

### Validation Rule

A Validation Rule is one reusable validation instruction.

Examples:

- The medical-event date must fall within the policy period.
- The patient name must match across the medical report and invoice.
- A medical report is required.
- An invoice must contain the Provider name and total amount.
- Human review is required when a possible pre-existing condition is identified.

### Validation Scheme

A Validation Scheme is a named collection of Validation Rules used for a particular insurer, product, Client, country, jurisdiction or document-validation use case.

A Case is validated against one immutable Validation Scheme version.

Do not treat a scheme as one large prompt. Compile the scheme once and execute only the rules relevant to the Case and its documents.

### Rule Parameter

A parameter configures reusable rule logic without duplicating that logic.

Examples include field paths, thresholds, currencies, date boundaries, severity and HITL policy.

## 2. Rule Scopes

```ts
rule_scope: "global" | "client"
```

### Global Rule

A global rule is owned and managed by MedConnect. It may be used by all Clients, Client-connected Providers and standalone Providers.

A Client Admin can view and apply a published global rule but cannot edit, archive or delete it.

### Client-owned Rule

A Client-owned rule belongs to one Client. It may be used only by the owning Client and Providers actively connected to that Client.

It is unavailable to standalone Providers, unrelated Providers and other Clients.

Super Admin may inspect Client-owned rule definitions for governance, duplicate prevention and possible promotion. This must not expose Cases, documents, patient data or extracted medical values.

## 3. Role Permissions

### Super Admin

Can:

- create and edit draft global rules
- publish and archive global rules
- search global and Client-owned rules
- view Client-owned rule definitions and non-PII metadata
- use a Client-owned rule as the source for a new global rule
- view aggregate rule usage without Case-level data

Cannot:

- edit the original Client-owned rule
- access Cases, documents or extracted values
- replace Client-owned rules automatically
- change historical validation results

### Client Admin

Can:

- search and inspect published global rules
- apply global rules directly without copying them
- create and manage Client-owned rules
- assemble Client Validation Schemes
- add global and own Client rules to a scheme
- configure controlled parameters and HITL requirements
- view usage within their Client
- receive duplicate suggestions before creating a rule

Cannot:

- edit or archive global rules
- access rules owned by another Client
- change published versions
- change the versions pinned to historical validation runs

### Provider User

Can:

- see applicable schemes
- select a scheme when permitted
- view document requirements
- run validation
- view results, evidence and recommendations
- correct extracted values when permitted
- provide missing documents
- request Client HITL for a Client-connected Case

Cannot:

- create or edit rules or schemes
- view governance data, internal prompts or cross-Client usage
- select an unavailable rule version
- override a result outside an authorized HITL workflow

## 4. Rule Model

```ts
ValidationRule {
  id
  scope
  client_id
  name
  description
  category
  execution_type
  applicability
  provider_message_code
  admin_message_code
  severity
  hitl_policy
  status
  current_version_id
  source_rule_id
  created_by
  created_at
  updated_at
}
```

For global rules:

```ts
scope = "global"
client_id = null
```

For Client-owned rules:

```ts
scope = "client"
client_id = owning Client
```

## 5. Rule Categories

```ts
rule_category:
  "document_requirement" |
  "field_extraction" |
  "data_consistency" |
  "date_validation" |
  "eligibility" |
  "medical_clause" |
  "financial_validation" |
  "fraud_indicator"
```

Fraud indicators flag inconsistencies for review. They must not automatically label a person or Provider as fraudulent.

## 6. Execution Types

```ts
execution_type: "deterministic" | "ai_assisted"
```

### Deterministic Rules

Use deterministic execution whenever a result can be calculated without an LLM.

Supported v1 operations:

```ts
"required_document"
"required_field"
"equals"
"not_equals"
"date_between"
"date_before"
"date_after"
"amount_less_than_or_equal"
"amount_greater_than"
```

Do not introduce an unrestricted rule language, general programming DSL, JSONLogic, CEL or Drools in v1.

The following checks must not call an LLM:

- required document or field presence
- exact and normalized name matching
- policy-number matching
- date-range validation
- amount and threshold comparison
- currency validation
- supported file-type validation
- exact document-duplicate detection

Normalize values before comparison:

- names: trim, lowercase, normalize Unicode and remove irrelevant punctuation
- dates: ISO date
- money: integer minor units plus ISO currency
- countries: internal ISO-based code
- identifiers: normalized according to identifier type

### AI-assisted Rules

Use AI only when meaning must be interpreted from unstructured or ambiguous content.

An AI-assisted rule must declare the evidence it may read, the evaluation question, a deterministic applicability gate and a strict output schema.

```ts
AiRuleOutput {
  outcome: "pass" | "fail" | "needs_review"
  confidence: number
  evidence_ids: string[]
  reason_code: string
  recommendation_code: string | null
}
```

Do not accept unrestricted prose as the only result.

## 7. Applicability and Parameters

```ts
RuleApplicability {
  client_id?: string
  insurer_id?: string
  product_line?: string
  product_id?: string
  country_codes?: string[]
  jurisdiction_codes?: string[]
  document_types?: string[]
  case_types?: string[]
}
```

Applicability controls rule availability and execution. It does not replace the rule result.

Use universal logic wherever possible. Store insurer-specific paths, thresholds and settings as controlled parameters.

Example:

```ts
{
  rule: "event_date_within_coverage_period",
  parameters: {
    event_date_path: "medical_report.examination_date",
    start_date_path: "policy.start_date",
    end_date_path: "policy.end_date",
    inclusive_start: true,
    inclusive_end: true
  }
}
```

Parameters must not change underlying global rule logic. Create a Client-owned rule only when different logic is genuinely required.

## 8. Validation Schemes

```ts
ValidationScheme {
  id
  scope
  client_id
  name
  description
  insurer_id
  product_line
  product_id
  country_codes
  status
  current_version_id
}
```

A scheme version contains pinned rule references:

```ts
ValidationSchemeRule {
  scheme_version_id
  rule_version_id
  execution_order
  parameters
  enabled
  required
}
```

A Client scheme may contain published global rules and published rules owned by that Client. It must never contain another Client’s rules.

A standalone Provider may use only published global schemes composed entirely of published global rules.

## 9. Rule Reuse and Duplicate Prevention

Before creating a rule:

1. Search applicable published global rules.
2. Search rules owned by the same Client.
3. Compare category, execution type, operation, document types, field paths, parameters, applicability and normalized meaning.
4. Show exact and probable matches.
5. Allow the Admin to add a matching global rule directly to the scheme.
6. Create a Client-owned rule only when existing logic cannot satisfy the requirement.

```ts
duplicate_result: "exact_match" | "probable_match" | "no_match"
```

For an exact match, block duplicate creation and suggest the existing rule.

For a probable match, show differences and require a reason before creating a new rule.

AI may assist with similarity suggestions but must not automatically merge or replace rules.

## 10. Promotion to Global Rule

Super Admin may use a Client-owned rule as the source for a new global rule.

Promotion must:

1. Create a separate global rule.
2. Record the source rule and version.
3. Remove Client-specific identifiers and confidential wording.
4. Require Super Admin review before publication.
5. Preserve the original Client rule.
6. Leave existing schemes unchanged.
7. Never change historical validation results.

The owning Client may later replace its rule reference with the global rule through an explicit audited migration.

## 11. Versioning and Lifecycle

Published rules and schemes are immutable.

```ts
status: "draft" | "published" | "archived"
```

Editing a published item creates a new draft version.

```ts
ValidationRuleVersion {
  id
  rule_id
  version_number
  definition
  applicability
  provider_message_code
  admin_message_code
  created_by
  created_at
  published_by
  published_at
}
```

A Case validation run pins:

- Validation Scheme version
- every Validation Rule version
- resolved parameters
- extraction schema version
- execution-engine version
- model and prompt version for AI calls
- validation timestamp

Archived rules are unavailable for new scheme versions but remain available for historical reconstruction. A published or used rule cannot be hard-deleted.

## 12. Compiled Validation Plan

Compile each published scheme version once:

```ts
CompiledValidationPlan {
  scheme_version_id
  required_document_types
  extraction_fields_by_document_type
  deterministic_rules
  ai_rule_groups
  dependency_map
  hitl_policies
  compilation_version
}
```

Reuse the compiled plan for every Case assigned to that exact scheme version.

Do not ask an LLM to interpret rule configuration or the complete scheme during every validation run.

## 13. Token-optimized Execution Order

Execute validation in this order:

1. file metadata and exact-duplicate checks
2. cached document classification and extraction
3. required-document checks
4. required-field checks
5. deterministic comparisons and eligibility rules
6. AI applicability gates
7. targeted evidence retrieval
8. grouped AI evaluation only for unresolved applicable rules
9. HITL routing or standalone recommendation

A later layer must not run when an earlier layer already provides a definitive result.

## 14. Extract Once and Reuse

Extract each required field once per document version.

```ts
ExtractedField {
  document_version_id
  field_id
  value
  normalized_value
  confidence
  page
  evidence_reference
  extractor_version
}
```

All rules requiring the same field reuse the stored value.

Re-extract only when the document changes, extraction failed, configuration changed, the extractor version requires explicit reprocessing or an authorized user requests it.

Prefer embedded text parsing, standard OCR or specialized document extraction over a generative LLM when reliable structured extraction is possible.

## 15. AI Applicability Gates

Every AI rule must define:

```ts
AiRuleGate {
  required_document_types
  required_fields
  triggering_values
  skip_conditions
}
```

If the gate does not pass, return:

```ts
outcome = "skipped"
reason = "not_applicable"
```

No model call is made.

For example, a pre-existing-condition rule should run only when extracted diagnosis, history or relevant text contains a possible indicator requiring interpretation.

## 16. Evidence Retrieval and AI Grouping

Do not send complete Case files, policies or schemes to the model.

Provide only:

- exact rule IDs and versions
- exact applicable clauses
- required normalized fields
- relevant document passages
- evidence identifiers and locations
- the required output schema

Store insurer and policy clauses as versioned reusable content blocks. Send only the clauses required by the active rules.

Group AI rules only when they use the same evidence, evaluate a related topic and share a compatible output schema. Do not group unrelated rules when that would increase total context.

Choose the grouping that produces the smallest total input while preserving reliable results.

## 17. Model Routing

Use the least expensive model proven reliable for the task:

```text
Simple classification or structured extraction
  → specialized or small model

Clause interpretation with clear evidence
  → standard model

Complex ambiguity, conflicting evidence or high-risk rule
  → stronger model or HITL
```

Escalate only when confidence is below the threshold, evidence conflicts, structured output remains invalid after the permitted retry or the rule explicitly requires escalation.

Do not repeat a large prompt unchanged on a stronger model. Preserve results and narrow the unresolved evidence first.

## 18. Caching and Selective Invalidation

```ts
ExtractionCacheKey =
  document_content_hash +
  extraction_schema_version +
  extractor_version

RuleResultCacheKey =
  normalized_input_hash +
  rule_version_id +
  rule_parameters_hash +
  execution_engine_version
```

Never use only `case_id` as a cache key.

Maintain dependencies:

```ts
RuleDependency {
  rule_version_id
  document_types
  field_paths
}
```

When a document or extracted field changes:

1. Identify affected rules.
2. Invalidate only their results.
3. Preserve unaffected results.
4. Rerun only invalidated rules.
5. Call AI only for invalidated AI rules whose gates pass.

## 19. Validation Outcomes

```ts
outcome: "pass" | "fail" | "needs_review" | "skipped"
```

Use `skipped` when a rule is not applicable or cannot run because required input is unavailable. Missing required documents must be reported as missing requirements rather than ordinary comparison failures.

```ts
ValidationRuleResult {
  case_id
  validation_run_id
  rule_version_id
  outcome
  severity
  reason_code
  recommendation_code
  evidence_ids
  confidence
  executed_at
  cached
}
```

## 20. HITL

```ts
hitl_policy:
  "never" |
  "on_needs_review" |
  "on_fail" |
  "always"
```

For Client-connected Cases, matching outcomes create a Client HITL task.

The reviewer may confirm, override, request documents or return the Case to the Provider. Store the automated result and human decision separately. Every override requires a reason.

Standalone Cases do not create Client HITL. Show a recommendation that the result requires confirmation from the relevant Assistance Company or insurer.

## 21. Recommendation Templates

Use application templates instead of generating repetitive explanations with an LLM.

```ts
RecommendationTemplate {
  code
  message
  applicable_roles
  locale
}
```

Do not call an LLM to explain missing documents, missing fields, date mismatches, amount thresholds, unsupported document types or other deterministic outcomes.

Provider-facing messages must be clear, actionable and framed as guidance rather than guaranteed approval.

## 22. Short-circuit Rules

Apply safe short-circuiting:

- If a required policy document is missing, skip comparisons requiring policy fields.
- If no invoice exists, skip invoice-field comparisons.
- If a deterministic gate establishes that an AI clause is inapplicable, skip it.
- If a Case is returned for missing documentation, do not rerun unchanged rules.
- If a valid cached result exists, reuse it.

Short-circuiting must not hide other missing requirements that can be detected without AI.

## 23. Rule Conflicts

When applicable rules conflict:

1. Preserve both results.
2. Do not silently select one.
3. Mark the validation run `needs_review`.
4. Identify the conflicting rules and versions.
5. Require an explicit Client HITL decision for Client-connected Cases.
6. Show an external-confirmation recommendation for standalone Cases.

A Client-owned rule does not override a global rule unless the scheme explicitly defines that replacement.

## 24. Token Budgets and Usage Tracking

```ts
TokenBudget {
  extraction_max_input
  extraction_max_output
  clause_max_input
  clause_max_output
  retry_limit
  case_max_total
}
```

When the Case budget is reached, stop AI retries, preserve completed results and route unresolved results to Client HITL or standalone recommendations.

For every model call, record:

- Client where applicable
- Provider and Case identifiers without PII
- scheme and rule versions
- task type
- model and provider
- prompt and completion tokens
- cached or executed status
- retry number
- estimated cost
- duration and outcome

Do not store patient data, document text, extracted values or complete prompts in usage analytics.

Expose tokens per Case, tokens per completed validation, AI calls per Case, cache hit rate, deterministic-to-AI ratio, AI rules skipped by gates, cost per Client, cost per scheme, cost per rule and high-cost outliers.

## 25. Audit Requirements

Audit rule creation, version creation, publication, archival, scheme assignment, scheme composition changes, duplicate-warning confirmation, promotion, replacement, validation execution and HITL decisions.

Audit data must not contain document text, extracted medical values or other patient information.

## 26. Required Implementation Output

Before implementing:

1. Inspect the existing Validation Scheme and rule models.
2. Identify duplicated schemes, prompts and extraction work.
3. Propose migration to reusable versioned rule references.
4. Preserve historical scheme versions and validation results.
5. Implement the compiled execution plan.
6. Implement deterministic rule operations explicitly.
7. Implement extraction reuse, applicability gates, caching and selective invalidation.
8. Enforce rule ownership and scope in the backend.
9. Add tests proving deterministic rules never call an LLM.
10. Add tests for global reuse, Client isolation, version pinning, duplicate prevention, promotion, caching, targeted evidence, grouped AI evaluation, token budgets, HITL routing and standalone recommendations.

