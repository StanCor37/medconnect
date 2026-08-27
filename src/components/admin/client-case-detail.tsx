"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { ValidationPanel } from "@/components/validation-panel";

const RETURN_REASONS = [
  { value: "missing_document", label: "Missing document" },
  { value: "unreadable_document", label: "Unreadable document" },
  { value: "incorrect_document", label: "Incorrect document" },
  { value: "incorrect_information", label: "Incorrect information" },
  { value: "validation_conflict", label: "Validation conflict" },
  { value: "additional_information_required", label: "Additional information required" },
  { value: "other", label: "Other" },
];

const REJECTION_REASONS = [
  { value: "documentation_incomplete", label: "Documentation incomplete" },
  { value: "information_inconsistent", label: "Information inconsistent" },
  { value: "not_eligible", label: "Not eligible" },
  { value: "duplicate_submission", label: "Duplicate submission" },
  { value: "outside_policy_period", label: "Outside policy period" },
  { value: "service_not_covered", label: "Service not covered" },
  { value: "client_decision", label: "Client decision" },
  { value: "other", label: "Other" },
];

interface CaseRow {
  id: string;
  internalReference: string;
  status: string;
  version: number;
  patientReference: string | null;
  serviceType: string | null;
  eventDate: string | null;
}

interface DocumentRow {
  id: string;
  documentTypeCode: string | null;
  status: string;
  currentVersion: { versionNumber: number } | null;
}

/**
 * Client Admin's read-only view of a shared Case (spec §17): documents,
 * requirement/automated results, evidence, HITL — never upload, confirm-type,
 * or edit controls, which stay exclusively Provider-side.
 */
export function ClientCaseDetail({ caseId }: { caseId: string }) {
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState<string>("");
  const [rejectionReason, setRejectionReason] = useState<string>("");
  const [rejectionNote, setRejectionNote] = useState<string>("");
  const [reopenReason, setReopenReason] = useState<string>("");

  // Bumped by action handlers to trigger a re-fetch after a mutation.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [caseRes, docsRes] = await Promise.all([
          fetch(`/api/cases/${caseId}`, { credentials: "include" }),
          fetch(`/api/cases/${caseId}/documents`, { credentials: "include" }),
        ]);
        if (!caseRes.ok) throw new Error("not_found");
        const caseData = await caseRes.json();
        const documentsData = docsRes.ok ? await docsRes.json() : [];
        if (cancelled) return;
        setCaseRow(caseData);
        setDocuments(documentsData);
      } catch {
        if (!cancelled) setLoadError("This Case could not be loaded.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  async function performAction(action: string, body: Record<string, unknown>) {
    if (!caseRow) return;
    setActionError(null);
    setActionBusy(action);
    try {
      const res = await fetch(`/api/cases/${caseId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: caseRow.version, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(data?.message ?? "That action could not be completed.");
        return;
      }
      setReturnReason("");
      setRejectionReason("");
      setRejectionNote("");
      setReopenReason("");
      setRefreshToken((t) => t + 1);
    } finally {
      setActionBusy(null);
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }
  if (!caseRow) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle className="text-xl">{caseRow.internalReference}</CardTitle>
            <StatusBadge status={caseRow.status} />
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Patient Ref.</dt>
              <dd className="font-medium text-foreground">{caseRow.patientReference ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Service Type</dt>
              <dd className="font-medium text-foreground">{caseRow.serviceType ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Event Date</dt>
              <dd className="font-medium text-foreground">{caseRow.eventDate ? new Date(caseRow.eventDate).toLocaleDateString() : "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {(caseRow.status === "submitted_to_client" ||
        caseRow.status === "client_review_required" ||
        caseRow.status === "accepted" ||
        caseRow.status === "validated" ||
        caseRow.status === "validated_with_issues" ||
        caseRow.status === "closed" ||
        caseRow.status === "cancelled" ||
        caseRow.status === "rejected") && (
        <Card>
          <CardHeader>
            <CardTitle>Case actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {actionError && (
              <Alert variant="destructive">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}

            {caseRow.status === "submitted_to_client" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={actionBusy !== null} onClick={() => performAction("accept", {})}>
                  {actionBusy === "accept" ? "Accepting..." : "Accept"}
                </Button>
              </div>
            )}

            {(caseRow.status === "submitted_to_client" || caseRow.status === "client_review_required") && (
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-64">
                    <Select items={RETURN_REASONS} value={returnReason} onValueChange={(v) => setReturnReason(v as string)}>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue placeholder="Return reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {RETURN_REASONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actionBusy !== null || !returnReason}
                    onClick={() => performAction("return-to-provider", { returnReason })}
                  >
                    {actionBusy === "return-to-provider" ? "Returning..." : "Return to Provider"}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-64">
                    <Select items={REJECTION_REASONS} value={rejectionReason} onValueChange={(v) => setRejectionReason(v as string)}>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue placeholder="Rejection reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {REJECTION_REASONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    placeholder="Rejection note (required)"
                    value={rejectionNote}
                    onChange={(e) => setRejectionNote(e.target.value)}
                    rows={1}
                    className="min-h-9 flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={actionBusy !== null || !rejectionReason || !rejectionNote.trim()}
                    onClick={() => performAction("reject", { rejectionReason, rejectionNote: rejectionNote.trim() })}
                  >
                    {actionBusy === "reject" ? "Rejecting..." : "Reject"}
                  </Button>
                </div>
              </div>
            )}

            {caseRow.status === "accepted" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={actionBusy !== null} onClick={() => performAction("mark-liquidated", {})}>
                  {actionBusy === "mark-liquidated" ? "Marking..." : "Mark Liquidated"}
                </Button>
              </div>
            )}

            {(caseRow.status === "validated" || caseRow.status === "validated_with_issues") && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" disabled={actionBusy !== null} onClick={() => performAction("close", {})}>
                  {actionBusy === "close" ? "Closing..." : "Close"}
                </Button>
              </div>
            )}

            {(caseRow.status === "closed" || caseRow.status === "cancelled" || caseRow.status === "rejected") && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Textarea
                  placeholder="Reason for reopening (required)"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  rows={1}
                  className="min-h-9 flex-1"
                />
                <Button
                  variant="outline"
                  disabled={actionBusy !== null || !reopenReason.trim()}
                  onClick={() => performAction("reopen", { reason: reopenReason.trim() })}
                >
                  {actionBusy === "reopen" ? "Reopening..." : "Reopen"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ValidationPanel caseId={caseId} caseVersion={caseRow.version} variant="client" />

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {documents !== null && documents.length === 0 && <p className="text-sm text-muted-foreground">No documents shared yet.</p>}
          {documents !== null && documents.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-medium text-foreground">{doc.documentTypeCode ?? "Needs type"}</span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={doc.status} />
                    {doc.currentVersion && <span className="text-xs text-muted-foreground">v{doc.currentVersion.versionNumber}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
