"use client";

import { useEffect, useState } from "react";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

interface RunSummary {
  id: string;
  runNumber: number;
  status: string;
  overallResult: string | null;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
}

interface RequirementResultRow {
  id: string;
  requirementType: string;
  documentTypeCode: string | null;
  status: string;
  reasonCode: string;
}

interface RuleResultRow {
  id: string;
  outcome: string;
  severity: string;
  reasonCode: string;
  technicalErrorCode: string | null;
  ruleVersion: { name: string };
  hitlTask: { id: string; status: string } | null;
}

interface RunDetail extends RunSummary {
  requirementResults: RequirementResultRow[];
  ruleResults: RuleResultRow[];
}

const GROUP_LABELS: Record<string, string> = {
  actionRequired: "Action required",
  missing: "Missing or unreadable documents",
  failed: "Failed checks",
  review: "Needs review",
  warnings: "Warnings",
  passed: "Passed",
  skipped: "Not applicable",
  technical: "Technical issues",
};

/** Groups requirement + rule results per spec §12's 8-group presentation order — never a raw dump. */
function groupResults(detail: RunDetail) {
  const groups: Record<keyof typeof GROUP_LABELS, { label: string; text: string }[]> = {
    actionRequired: [],
    missing: [],
    failed: [],
    review: [],
    warnings: [],
    passed: [],
    skipped: [],
    technical: [],
  };

  for (const r of detail.requirementResults) {
    const label = `${r.documentTypeCode ?? r.requirementType} — ${r.reasonCode.replace(/_/g, " ")}`;
    if (r.status === "missing" || r.status === "unreadable") groups.missing.push({ label, text: r.status });
    else if (r.status === "unconfirmed" || r.status === "invalid") groups.actionRequired.push({ label, text: r.status });
    else groups.passed.push({ label, text: r.status });
  }

  for (const r of detail.ruleResults) {
    const label = r.ruleVersion.name;
    if (r.outcome === "processing_error") groups.technical.push({ label, text: r.technicalErrorCode ?? "technical error" });
    else if (r.outcome === "not_executed") groups.actionRequired.push({ label, text: "needs input" });
    else if (r.outcome === "needs_review") groups.review.push({ label, text: "needs review" });
    else if (r.outcome === "skipped") groups.skipped.push({ label, text: "not applicable" });
    else if (r.outcome === "fail") (r.severity === "blocking" ? groups.failed : groups.warnings).push({ label, text: "failed" });
    else groups.passed.push({ label, text: "passed" });
  }

  return groups;
}

export function ValidationPanel({
  caseId,
  caseVersion,
  variant = "provider",
}: {
  caseId: string;
  caseVersion: number;
  /** "provider" can trigger a real validation run; "client" can only request one, per spec §17 (Client Admin never triggers execution directly). */
  variant?: "provider" | "client";
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/cases/${caseId}/validation-runs`, { credentials: "include" });
      if (!res.ok || cancelled) return;
      const data: RunSummary[] = await res.json();
      setRuns(data);
      if (data.length > 0) setSelectedRunId((prev) => prev ?? data[0].id);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  useEffect(() => {
    if (!selectedRunId) return;
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/validation-runs/${selectedRunId}`, { credentials: "include" });
      if (!res.ok || cancelled) return;
      setDetail(await res.json());
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, refreshToken]);

  async function handleValidate() {
    setError(null);
    setValidating(true);
    try {
      const endpoint = variant === "client" ? `/api/cases/${caseId}/request-revalidation` : `/api/cases/${caseId}/validate`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: caseVersion }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not run validation.");
        return;
      }
      setSelectedRunId(data.id);
      setRefreshToken((t) => t + 1);
    } finally {
      setValidating(false);
    }
  }

  const groups = detail ? groupResults(detail) : null;
  const summaryCounts = groups
    ? {
        actionRequired: groups.actionRequired.length,
        missing: groups.missing.length,
        review: groups.review.length,
        passed: groups.passed.length,
      }
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Validation</CardTitle>
          <Button size="sm" disabled={validating} onClick={handleValidate}>
            <PlayCircle className="size-4" />
            {validating
              ? variant === "client"
                ? "Requesting..."
                : "Validating..."
              : variant === "client"
                ? "Request Revalidation"
                : runs && runs.length > 0
                  ? "Revalidate"
                  : "Validate"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {runs !== null && runs.length === 0 && !validating && (
          <p className="text-sm text-muted-foreground">No validation runs yet.</p>
        )}

        {runs && runs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRunId(r.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${r.id === selectedRunId ? "border-primary bg-accent" : "border-border"}`}
              >
                Run {r.runNumber} {r.status === "superseded" ? "(superseded)" : "(current)"}
              </button>
            ))}
          </div>
        )}

        {detail && groups && summaryCounts && (
          <>
            <div className="flex items-center gap-2">
              {detail.overallResult && <StatusBadge status={detail.overallResult} />}
              <span className="text-sm text-muted-foreground">
                {summaryCounts.actionRequired} actions required · {summaryCounts.missing} missing · {summaryCounts.review} need review ·{" "}
                {summaryCounts.passed} passed
              </span>
            </div>

            {(Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[]).map(
              (key) =>
                groups[key].length > 0 && (
                  <div key={key} className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-muted-foreground">{GROUP_LABELS[key]}</p>
                    <ul className="flex flex-col gap-1">
                      {groups[key].map((item, i) => (
                        <li key={i} className="rounded-lg border border-border px-2.5 py-1.5 text-sm">
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
