"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

interface SchemeRuleRow {
  id: string;
  executionOrder: number;
  enabled: boolean;
  required: boolean;
  ruleVersion: { name: string; versionNumber: number };
}
interface DocTypeRow {
  id: string;
  code: string;
  name: string;
  required: boolean;
  multipleAllowed: boolean;
  acceptedMimeTypes: string[];
}
interface VersionDetail {
  id: string;
  versionNumber: number;
  publishedAt: string | null;
  schemeRules: SchemeRuleRow[];
  documentTypeDefinitions: DocTypeRow[];
}
interface Scheme {
  id: string;
  name: string;
  description: string | null;
  scope: "global" | "client";
  status: "draft" | "published" | "archived";
  version: number;
  currentVersion: VersionDetail | null;
}
interface RuleOption {
  id: string;
  name: string;
  scope: "global" | "client";
  currentVersion: { id: string } | null;
}

export function SchemeDetail({
  basePath,
  schemeId,
  viewerRole,
}: {
  basePath: string;
  schemeId: string;
  viewerRole: "client_admin" | "super_admin";
}) {
  const router = useRouter();
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
  const [draftVersion, setDraftVersion] = useState<VersionDetail | null>(null);
  const [ruleOptions, setRuleOptions] = useState<RuleOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [executionOrder, setExecutionOrder] = useState("0");
  const [dtCode, setDtCode] = useState("");
  const [dtName, setDtName] = useState("");
  const [dtMimeTypes, setDtMimeTypes] = useState("application/pdf, image/jpeg, image/png");
  const [dtRequired, setDtRequired] = useState(false);
  const [dtExpectedFields, setDtExpectedFields] = useState("[]");
  const [dtClassificationHints, setDtClassificationHints] = useState('{"filenameKeywords": [], "textKeywords": []}');
  // Bumped by handlers after a mutation to trigger a re-fetch, rather than
  // calling an async loader directly from the effect body (which risks
  // cascading renders) — the two effects below are the only things that fetch.
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = () => setRefreshToken((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/schemes/${schemeId}`, { credentials: "include" });
      if (cancelled) return;
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      setScheme(await res.json());
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [schemeId, refreshToken]);

  useEffect(() => {
    if (!draftVersionId) return;
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/schemes/${schemeId}?versionId=${draftVersionId}`, { credentials: "include" });
      if (cancelled) return;
      const data = await res.json();
      setDraftVersion(data.editableVersion);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [schemeId, draftVersionId, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/rules?status=published", { credentials: "include" });
      const data = await res.json();
      if (!cancelled) setRuleOptions(data);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const editableVersionId = scheme?.status === "draft" ? (scheme.currentVersion?.id ?? null) : draftVersionId;
  const editableVersion = scheme?.status === "draft" ? scheme.currentVersion : draftVersion;
  const canEdit =
    !!scheme &&
    ((viewerRole === "super_admin" && scheme.scope === "global") || (viewerRole === "client_admin" && scheme.scope === "client"));

  async function handleCreateNextDraft() {
    if (!scheme) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/schemes/${schemeId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: scheme.version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not start a new draft version.");
        return;
      }
      setDraftVersionId(data.id);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleAddRule() {
    if (!scheme || !editableVersionId || !selectedRuleId) return;
    const rule = ruleOptions.find((r) => r.id === selectedRuleId);
    if (!rule?.currentVersion) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/schemes/${schemeId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          version: scheme.version,
          schemeVersionId: editableVersionId,
          ruleVersionId: rule.currentVersion.id,
          executionOrder: Number(executionOrder) || 0,
          enabled: true,
          required: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not add this Rule.");
        return;
      }
      setSelectedRuleId("");
      setExecutionOrder("0");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveRule(schemeRuleId: string) {
    if (!scheme || !editableVersionId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/schemes/${schemeId}/rules/${schemeRuleId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: scheme.version, schemeVersionId: editableVersionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not remove this Rule.");
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleAddDocumentType() {
    if (!scheme || !editableVersionId || !dtCode.trim() || !dtName.trim()) return;
    let expectedFields: unknown;
    let classificationHints: unknown;
    try {
      expectedFields = dtExpectedFields.trim() ? JSON.parse(dtExpectedFields) : [];
      classificationHints = dtClassificationHints.trim() ? JSON.parse(dtClassificationHints) : {};
    } catch {
      setError("Expected fields / classification hints must be valid JSON.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/schemes/${schemeId}/document-types`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          version: scheme.version,
          schemeVersionId: editableVersionId,
          code: dtCode.trim(),
          name: dtName.trim(),
          acceptedMimeTypes: dtMimeTypes
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean),
          required: dtRequired,
          multipleAllowed: true,
          expectedFields,
          classificationHints,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not add this Document Type.");
        return;
      }
      setDtCode("");
      setDtName("");
      setDtRequired(false);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveDocumentType(docTypeId: string) {
    if (!scheme || !editableVersionId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/schemes/${schemeId}/document-types/${docTypeId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: scheme.version, schemeVersionId: editableVersionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not remove this Document Type.");
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!scheme || !editableVersionId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/schemes/${schemeId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: scheme.version, versionId: editableVersionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not publish this version.");
        return;
      }
      setDraftVersionId(null);
      setDraftVersion(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!scheme) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/schemes/${schemeId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: scheme.version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not archive this Scheme.");
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!scheme) return;
    if (!window.confirm("Remove this Scheme? Published schemes are archived instead of deleted.")) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/schemes/${schemeId}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not remove this Scheme.");
        return;
      }
      router.push(`${basePath}/schemes`);
    } finally {
      setBusy(false);
    }
  }

  if (notFound) return <p className="text-sm text-muted-foreground">Scheme not found.</p>;
  if (!scheme) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const eligibleRules = ruleOptions.filter((r) => (scheme.scope === "global" ? r.scope === "global" : true));
  // Always show the best data we have — the editable draft's own lists while
  // one is being worked on, falling back to the published currentVersion's
  // lists (read-only) once there's no active draft, e.g. right after Publish.
  const displayVersion = editableVersion ?? scheme.currentVersion;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">{scheme.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {scheme.scope}
            </Badge>
            <StatusBadge status={scheme.status} />
          </div>
          {scheme.description && <p className="mt-2 text-sm text-muted-foreground">{scheme.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && scheme.status === "published" && !draftVersionId && (
            <Button variant="outline" size="sm" disabled={busy} onClick={handleCreateNextDraft}>
              Create next draft
            </Button>
          )}
          {canEdit && editableVersionId && editableVersion?.publishedAt === null && (
            <Button size="sm" disabled={busy} onClick={handlePublish}>
              Publish
            </Button>
          )}
          {canEdit && scheme.status !== "archived" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={handleArchive}>
              Archive
            </Button>
          )}
          {canEdit && (
            <Button variant="destructive" size="sm" disabled={busy} onClick={handleDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Rules {displayVersion && `(v${displayVersion.versionNumber})`}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(displayVersion?.schemeRules.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No Rules attached.</p>
          )}
          {displayVersion?.schemeRules.map((sr) => (
            <div key={sr.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{sr.ruleVersion.name}</p>
                <p className="text-xs text-muted-foreground">
                  order {sr.executionOrder} · {sr.enabled ? "enabled" : "disabled"} · {sr.required ? "required" : "optional"}
                </p>
              </div>
              {canEdit && editableVersion?.publishedAt === null && (
                <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => handleRemoveRule(sr.id)}>
                  <X className="size-4" />
                </Button>
              )}
            </div>
          ))}

          {canEdit && editableVersion?.publishedAt === null && (
            <div className="flex items-end gap-2 border-t border-border pt-3">
              <div className="flex flex-1 flex-col gap-2">
                <Label>Rule</Label>
                <Select
                  items={eligibleRules.map((r) => ({ label: r.name, value: r.id }))}
                  value={selectedRuleId}
                  onValueChange={(v) => setSelectedRuleId(v as string)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a published Rule" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleRules.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-24 flex-col gap-2">
                <Label>Order</Label>
                <Input type="number" value={executionOrder} onChange={(e) => setExecutionOrder(e.target.value)} />
              </div>
              <Button disabled={busy || !selectedRuleId} onClick={handleAddRule}>
                Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Document Types</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(displayVersion?.documentTypeDefinitions.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No Document Types attached.</p>
          )}
          {displayVersion?.documentTypeDefinitions.map((dt) => (
            <div key={dt.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <div>
                <p className="font-medium">
                  {dt.name} <span className="text-xs text-muted-foreground">({dt.code})</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {dt.required ? "required" : "optional"} · {dt.multipleAllowed ? "multiple allowed" : "single only"}
                </p>
              </div>
              {canEdit && editableVersion?.publishedAt === null && (
                <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => handleRemoveDocumentType(dt.id)}>
                  <X className="size-4" />
                </Button>
              )}
            </div>
          ))}

          {canEdit && editableVersion?.publishedAt === null && (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Code</Label>
                  <Input value={dtCode} onChange={(e) => setDtCode(e.target.value)} placeholder="invoice" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Name</Label>
                  <Input value={dtName} onChange={(e) => setDtName(e.target.value)} placeholder="Invoice" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Accepted MIME types (comma-separated)</Label>
                <Input value={dtMimeTypes} onChange={(e) => setDtMimeTypes(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={dtRequired} onChange={(e) => setDtRequired(e.target.checked)} />
                Required
              </label>
              <div className="flex flex-col gap-2">
                <Label>Expected fields (JSON)</Label>
                <Textarea
                  value={dtExpectedFields}
                  onChange={(e) => setDtExpectedFields(e.target.value)}
                  rows={2}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Classification hints (JSON)</Label>
                <Textarea
                  value={dtClassificationHints}
                  onChange={(e) => setDtClassificationHints(e.target.value)}
                  rows={2}
                  className="font-mono text-xs"
                />
              </div>
              <Button disabled={busy || !dtCode.trim() || !dtName.trim()} onClick={handleAddDocumentType}>
                Add Document Type
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
