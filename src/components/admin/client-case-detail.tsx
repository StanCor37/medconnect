"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { ValidationPanel } from "@/components/validation-panel";

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
  }, [caseId]);

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
