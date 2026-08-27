import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Restrained semantic colors for status — never the brand/primary color,
// which stays reserved for actions. Covers Case, Document, and
// Rule/Scheme lifecycle statuses since they all share the same
// "draft / in-progress / ready / problem" shape.
//
// Colors come from the design-system status tokens in globals.css rather
// than raw Tailwind palette classes, so dark mode and future palette changes
// are handled in one place.
const POSITIVE = new Set([
  "ready",
  "active",
  "validated",
  "validated_with_issues",
  "accepted",
  "liquidated",
  "submitted_to_client",
  "closed",
  "confirmed",
  "corrected",
  "published",
]);
const PENDING = new Set([
  "needs_type_confirmation",
  "needs_split_confirmation",
  "processing",
  "uploading",
  "partially_readable",
  "provider_action_required",
  "client_review_required",
  "returned_to_provider",
  "ready_for_validation",
  "validating",
  "documents_in_progress",
  "suggested",
  "extracted",
  "low_confidence",
  "inconsistent",
  "not_extracted",
  "invited",
]);
const NEGATIVE = new Set([
  "unreadable",
  "failed",
  "rejected",
  "cancelled",
  "unclear",
  "absent",
  "invalid",
  "suspended",
  "deactivated",
]);

export function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");

  if (NEGATIVE.has(status)) {
    return (
      <Badge variant="destructive" className="capitalize">
        {label}
      </Badge>
    );
  }
  if (POSITIVE.has(status)) {
    return (
      <Badge
        className={cn(
          "border-[var(--status-positive-border)] bg-[var(--status-positive-bg)] text-[var(--status-positive-fg)] capitalize hover:bg-[var(--status-positive-bg)]"
        )}
      >
        {label}
      </Badge>
    );
  }
  if (PENDING.has(status)) {
    return (
      <Badge
        className={cn(
          "border-[var(--status-pending-border)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] capitalize hover:bg-[var(--status-pending-bg)]"
        )}
      >
        {label}
      </Badge>
    );
  }
  // draft / archived / anything else — neutral
  return (
    <Badge variant="outline" className="capitalize">
      {label}
    </Badge>
  );
}
