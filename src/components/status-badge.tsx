import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Restrained semantic colors for status — never the brand/primary color,
// which stays reserved for actions. Covers Case, Document, and
// Rule/Scheme lifecycle statuses since they all share the same
// "draft / in-progress / ready / problem" shape.
const POSITIVE = new Set([
  "ready",
  "active",
  "validated",
  "validated_with_issues",
  "accepted",
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
]);
const NEGATIVE = new Set(["unreadable", "failed", "rejected", "cancelled", "unclear", "absent", "invalid"]);

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
      <Badge className={cn("border-green-200 bg-green-50 text-green-700 capitalize hover:bg-green-50")}>
        {label}
      </Badge>
    );
  }
  if (PENDING.has(status)) {
    return (
      <Badge className={cn("border-amber-200 bg-amber-50 text-amber-700 capitalize hover:bg-amber-50")}>
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
