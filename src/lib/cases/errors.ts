/**
 * Split out from service.ts specifically so src/lib/cases/stateMachine.ts
 * can throw CaseServiceError without an import cycle back into service.ts
 * (which itself needs stateMachine.ts's transitionCaseStatus). service.ts
 * re-exports both names, so every existing route import
 * (`from "@/lib/cases/service"`) keeps working unchanged.
 */
export class CaseServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function caseErrorStatus(code: string): number {
  switch (code) {
    case "duplicate_external_reference":
      return 409;
    case "idempotency_key_conflict":
      return 409;
    case "stale_version":
      return 409;
    case "probable_duplicate_case":
      return 422;
    case "inactive_relationship":
      return 422;
    case "invalid_state":
      return 409;
    case "invalid_transition":
      return 409;
    case "invalid_scheme_state":
      return 409;
    case "incompatible_scheme":
      return 422;
    case "invalid_input":
      return 400;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    default:
      return 400;
  }
}
