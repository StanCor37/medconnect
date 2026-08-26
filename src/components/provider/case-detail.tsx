"use client";

import { useEffect, useState } from "react";
import { Upload, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { DocumentDetails } from "@/components/provider/document-details";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CaseRow {
  id: string;
  internalReference: string;
  status: string;
  clientId: string | null;
  patientReference: string | null;
  serviceType: string | null;
  eventDate: string | null;
}

interface DocumentRow {
  id: string;
  documentTypeCode: string | null;
  status: string;
  version: number;
  currentVersion: { id: string; versionNumber: number; classificationStatus: string } | null;
}

interface DocumentTypeOption {
  code: string;
  name: string;
}

interface UploadResult {
  filename: string;
  status: "created" | "duplicate" | "rejected";
  errorCode?: string;
}

export function CaseDetail({ caseId }: { caseId: string }) {
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [uploadTypeCode, setUploadTypeCode] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [confirmingTypeFor, setConfirmingTypeFor] = useState<string | null>(null);
  const [confirmSelections, setConfirmSelections] = useState<Record<string, string>>({});
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [removingDocId, setRemovingDocId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Bumped by handlers after a mutation to trigger a re-fetch, rather than
  // calling an async loader directly from the effect body (which risks
  // cascading renders) — the effect below is the only thing that fetches.
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = () => setRefreshToken((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [caseRes, docsRes, typesRes] = await Promise.all([
          fetch(`/api/cases/${caseId}`, { credentials: "include" }),
          fetch(`/api/cases/${caseId}/documents`, { credentials: "include" }),
          fetch(`/api/cases/${caseId}/document-types`, { credentials: "include" }),
        ]);
        if (!caseRes.ok) throw new Error("not_found");
        const caseData = await caseRes.json();
        const documentsData = docsRes.ok ? await docsRes.json() : [];
        const typesData = typesRes.ok ? await typesRes.json() : [];
        if (cancelled) return;
        setCaseRow(caseData);
        setDocuments(documentsData);
        setDocumentTypes(typesData);
      } catch {
        if (!cancelled) setLoadError("This Case could not be loaded.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  async function handleUpload() {
    if (!selectedFiles || selectedFiles.length === 0) return;
    setUploading(true);
    setUploadError(null);
    setUploadResults(null);
    try {
      const form = new FormData();
      Array.from(selectedFiles).forEach((f) => form.append("files", f));
      if (uploadTypeCode) form.append("documentTypeCode", uploadTypeCode);

      const res = await fetch(`/api/cases/${caseId}/documents`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.message ?? "Upload failed.");
        return;
      }
      setUploadResults(data);
      setSelectedFiles(null);
      refresh();
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirmType(doc: DocumentRow) {
    const typeCode = confirmSelections[doc.id];
    if (!typeCode) return;
    setConfirmingTypeFor(doc.id);
    try {
      const res = await fetch(`/api/documents/${doc.id}/confirm-type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: doc.version, documentTypeCode: typeCode }),
      });
      if (res.ok) refresh();
    } finally {
      setConfirmingTypeFor(null);
    }
  }

  async function handleRemove(doc: DocumentRow) {
    const confirmed = window.confirm(
      "Remove this document? If it has no activity yet it will be deleted permanently; otherwise it will be archived."
    );
    if (!confirmed) return;
    setRemoveError(null);
    setRemovingDocId(doc.id);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE", credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRemoveError(data?.message ?? "Could not remove this document.");
        return;
      }
      refresh();
    } finally {
      setRemovingDocId(null);
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  if (!caseRow) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

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
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Client</dt>
              <dd className="font-medium text-foreground">{caseRow.clientId ? "Shared" : "Standalone"}</dd>
            </div>
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
              <dd className="font-medium text-foreground">
                {caseRow.eventDate ? new Date(caseRow.eventDate).toLocaleDateString() : "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload documents</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <input
                type="file"
                multiple
                onChange={(e) => setSelectedFiles(e.target.files)}
                className="block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
              />
            </div>
            <div className="w-full sm:w-56">
              <Select
                items={documentTypes.map((t) => ({ label: t.name, value: t.code }))}
                value={uploadTypeCode}
                onValueChange={(v) => setUploadTypeCode(v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Document type (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {documentTypes.map((t) => (
                    <SelectItem key={t.code} value={t.code}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleUpload} disabled={!selectedFiles || selectedFiles.length === 0 || uploading}>
              <Upload className="size-4" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>

          {uploadError && (
            <Alert variant="destructive">
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}
          {uploadResults && (
            <ul className="flex flex-col gap-1 text-sm">
              {uploadResults.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-muted-foreground">{r.filename}:</span>
                  <span
                    className={
                      r.status === "created" ? "text-green-700" : r.status === "duplicate" ? "text-amber-700" : "text-destructive"
                    }
                  >
                    {r.status}
                    {r.errorCode ? ` (${r.errorCode})` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {removeError && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          )}
          {documents === null && <Skeleton className="h-16 w-full" />}
          {documents !== null && documents.length === 0 && (
            <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
          )}
          {documents !== null && documents.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {documents.map((doc) => (
                <li key={doc.id} className="flex flex-col gap-3 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {doc.documentTypeCode ?? "Needs type"}
                      </span>
                      <StatusBadge status={doc.status} />
                      {doc.currentVersion && (
                        <span className="text-xs text-muted-foreground">v{doc.currentVersion.versionNumber}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.status === "needs_type_confirmation" && (
                        <>
                          <Select
                            items={documentTypes.map((t) => ({ label: t.name, value: t.code }))}
                            value={confirmSelections[doc.id] ?? ""}
                            onValueChange={(v) => setConfirmSelections((prev) => ({ ...prev, [doc.id]: v as string }))}
                          >
                            <SelectTrigger size="sm" className="w-44">
                              <SelectValue placeholder="Choose type" />
                            </SelectTrigger>
                            <SelectContent>
                              {documentTypes.map((t) => (
                                <SelectItem key={t.code} value={t.code}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            disabled={!confirmSelections[doc.id] || confirmingTypeFor === doc.id}
                            onClick={() => handleConfirmType(doc)}
                          >
                            Confirm
                          </Button>
                        </>
                      )}
                      {doc.currentVersion && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setExpandedDocId((prev) => (prev === doc.id ? null : doc.id))}
                          >
                            {expandedDocId === doc.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            Details
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            nativeButton={false}
                            render={
                              <a
                                href={`/api/documents/${doc.id}/versions/${doc.currentVersion.id}/download`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Download className="size-4" />
                                Download
                              </a>
                            }
                          />
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        disabled={removingDocId === doc.id}
                        onClick={() => handleRemove(doc)}
                      >
                        <Trash2 className="size-4" />
                        {removingDocId === doc.id ? "Removing..." : "Remove"}
                      </Button>
                    </div>
                  </div>
                  {expandedDocId === doc.id && doc.currentVersion && (
                    <DocumentDetails
                      documentId={doc.id}
                      documentVersion={doc.version}
                      documentTypeCode={doc.documentTypeCode}
                      classificationStatus={doc.currentVersion.classificationStatus}
                      documentTypes={documentTypes}
                      onTypeConfirmed={refresh}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
