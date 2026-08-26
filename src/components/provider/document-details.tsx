"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";

interface DocumentTypeOption {
  code: string;
  name: string;
}

interface ClassificationResult {
  suggestedTypeCode: string | null;
  confidence: number | null;
  method: string;
}

interface ExtractedFieldRow {
  fieldDefinitionId: string;
  code: string;
  label: string;
  valueType: string;
  required: boolean;
  status: string;
  rawValue: string | null;
  normalizedValue: unknown;
  confirmedValue: unknown;
  correctionReason: string | null;
}

const CONFIRMABLE_STATUSES = new Set(["extracted", "low_confidence", "inconsistent", "invalid"]);

function isMoneyValue(v: unknown): v is { minorUnits: number; currency: string | null } {
  return typeof v === "object" && v !== null && "minorUnits" in v;
}

function formatValue(valueType: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (valueType === "money" && isMoneyValue(value)) {
    return `${(value.minorUnits / 100).toFixed(2)}${value.currency ? " " + value.currency : ""}`;
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Shown when a Document's currentVersion row is expanded on the Case detail
 * page. Fetches classification + extracted-field state for just this one
 * Document (not eagerly for every row in the list — avoids N+1 fetches).
 */
export function DocumentDetails({
  documentId,
  documentVersion,
  documentTypeCode,
  classificationStatus,
  documentTypes,
  onTypeConfirmed,
}: {
  documentId: string;
  documentVersion: number;
  documentTypeCode: string | null;
  classificationStatus: string;
  documentTypes: DocumentTypeOption[];
  onTypeConfirmed: () => void;
}) {
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [fields, setFields] = useState<ExtractedFieldRow[] | null>(null);
  const [changeSelection, setChangeSelection] = useState("");
  const [confirmingType, setConfirmingType] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [classRes, fieldsRes] = await Promise.all([
        fetch(`/api/documents/${documentId}/classification`, { credentials: "include" }),
        fetch(`/api/documents/${documentId}/extracted-fields`, { credentials: "include" }),
      ]);
      if (cancelled) return;
      setClassification(classRes.ok ? await classRes.json() : null);
      setFields(fieldsRes.ok ? await fieldsRes.json() : []);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [documentId, refreshToken]);

  async function confirmType(typeCode: string) {
    setConfirmingType(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/confirm-type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: documentVersion, documentTypeCode: typeCode }),
      });
      if (res.ok) onTypeConfirmed();
    } finally {
      setConfirmingType(false);
    }
  }

  const suggestedTypeName = classification?.suggestedTypeCode
    ? (documentTypes.find((t) => t.code === classification.suggestedTypeCode)?.name ?? classification.suggestedTypeCode)
    : null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4">
      {!documentTypeCode && classificationStatus === "suggested" && suggestedTypeName && (
        <Alert>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              We identified this as: <strong className="text-foreground">{suggestedTypeName}</strong>
              {classification?.confidence != null && ` (${Math.round(classification.confidence * 100)}%)`}
            </span>
            <Button size="sm" disabled={confirmingType} onClick={() => confirmType(classification!.suggestedTypeCode!)}>
              Use this suggestion
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!documentTypeCode && classificationStatus === "unclear" && (
        <Alert variant="destructive">
          <AlertDescription>We could not determine the document type. Choose the type that best matches this document.</AlertDescription>
        </Alert>
      )}
      {!documentTypeCode && (
        <div className="flex items-center gap-2">
          <Select
            items={documentTypes.map((t) => ({ label: t.name, value: t.code }))}
            value={changeSelection}
            onValueChange={(v) => setChangeSelection(v as string)}
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
          <Button size="sm" variant="outline" disabled={!changeSelection || confirmingType} onClick={() => confirmType(changeSelection)}>
            {classificationStatus === "suggested" ? "Change type" : "Confirm"}
          </Button>
        </div>
      )}

      {fields === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {fields !== null && documentTypeCode && fields.length > 0 && (
        <ExtractedFieldsTable documentId={documentId} fields={fields} onChanged={() => setRefreshToken((t) => t + 1)} />
      )}
      {fields !== null && documentTypeCode && fields.length === 0 && (
        <p className="text-sm text-muted-foreground">No structured fields configured for this document type.</p>
      )}
    </div>
  );
}

function ExtractedFieldsTable({
  documentId,
  fields,
  onChanged,
}: {
  documentId: string;
  fields: ExtractedFieldRow[];
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(fieldDefinitionId: string, action: "confirm" | "correct" | "mark-absent", body?: { value: string }) {
    setBusyId(fieldDefinitionId);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/extracted-fields/${fieldDefinitionId}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "That didn't work.");
        return;
      }
      setEditingId(null);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-foreground">Extracted fields</h4>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((f) => {
            const editing = editingId === f.fieldDefinitionId;
            const displayValue = f.confirmedValue ?? f.normalizedValue ?? f.rawValue;
            const busy = busyId === f.fieldDefinitionId;
            return (
              <TableRow key={f.fieldDefinitionId}>
                <TableCell className="font-medium">
                  {f.label}
                  {f.required && <span className="text-destructive"> *</span>}
                </TableCell>
                <TableCell>
                  {editing ? (
                    <div className="flex items-center gap-2">
                      <Input value={draftValue} onChange={(e) => setDraftValue(e.target.value)} className="h-8 w-40" autoFocus />
                      <Button size="sm" disabled={busy || !draftValue.trim()} onClick={() => act(f.fieldDefinitionId, "correct", { value: draftValue })}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    formatValue(f.valueType, displayValue)
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={f.status} />
                </TableCell>
                <TableCell className="text-right">
                  {!editing && (
                    <div className="flex justify-end gap-2">
                      {CONFIRMABLE_STATUSES.has(f.status) && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => act(f.fieldDefinitionId, "confirm")}>
                          Confirm
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(f.fieldDefinitionId);
                          setDraftValue(f.rawValue ?? "");
                        }}
                      >
                        Correct
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => act(f.fieldDefinitionId, "mark-absent")}>
                        Not present
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
