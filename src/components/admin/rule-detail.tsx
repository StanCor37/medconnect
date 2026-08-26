"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { RuleForm } from "@/components/admin/rule-form";

interface RuleVersion {
  id: string;
  versionNumber: number;
  name: string;
  description: string | null;
  definition: unknown;
  applicability: unknown;
  providerMessageCode: string;
  adminMessageCode: string;
  severity: string;
  hitlPolicy: string;
  publishedAt: string | null;
}
interface Rule {
  id: string;
  name: string;
  category: string;
  executionType: string;
  scope: "global" | "client";
  status: "draft" | "published" | "archived";
  version: number;
  currentVersion: RuleVersion | null;
}

function toFormInitial(v: RuleVersion) {
  return {
    name: v.name,
    description: v.description ?? "",
    providerMessageCode: v.providerMessageCode,
    adminMessageCode: v.adminMessageCode,
    severity: v.severity,
    hitlPolicy: v.hitlPolicy,
    applicability: JSON.stringify(v.applicability, null, 2),
    definition: JSON.stringify(v.definition, null, 2),
  };
}

export function RuleDetail({
  basePath,
  ruleId,
  currentUserId,
  viewerRole,
}: {
  basePath: string;
  ruleId: string;
  currentUserId: string;
  viewerRole: "client_admin" | "super_admin";
}) {
  const router = useRouter();
  const [rule, setRule] = useState<Rule | null>(null);
  const [draftVersion, setDraftVersion] = useState<RuleVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // Bumped by handlers after a mutation to trigger a re-fetch, rather than
  // calling an async loader directly from the effect body (which risks
  // cascading renders) — the effect below is the only thing that fetches.
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = () => setRefreshToken((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/rules/${ruleId}`, { credentials: "include" });
      if (cancelled) return;
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      setRule(await res.json());
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [ruleId, refreshToken]);

  const canEdit =
    !!rule && ((viewerRole === "super_admin" && rule.scope === "global") || (viewerRole === "client_admin" && rule.scope === "client"));
  const canPromote = !!rule && viewerRole === "super_admin" && rule.scope === "client";

  async function handlePublish(versionId: string) {
    if (!rule) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/rules/${ruleId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: rule.version, versionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not publish this version.");
        return;
      }
      setDraftVersion(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateNextDraft() {
    if (!rule) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/rules/${ruleId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: rule.version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not start a new draft version.");
        return;
      }
      setDraftVersion(data);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!rule) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/rules/${ruleId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: rule.version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not archive this Rule.");
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!rule) return;
    if (!window.confirm("Remove this Rule? Published rules are archived instead of deleted.")) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/rules/${ruleId}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not remove this Rule.");
        return;
      }
      router.push(`${basePath}/rules`);
    } finally {
      setBusy(false);
    }
  }

  async function handlePromote() {
    if (!rule?.currentVersion) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/rules/${ruleId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ versionId: rule.currentVersion.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "probable_duplicate_rule") {
          const confirmRes = await fetch(`/api/rules/${ruleId}/promote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ versionId: rule.currentVersion.id, confirmedNotDuplicateBy: currentUserId }),
          });
          const confirmData = await confirmRes.json();
          if (!confirmRes.ok) {
            setError(confirmData.message ?? "Could not promote this Rule.");
            return;
          }
          router.push(`${basePath}/rules/${confirmData.id}`);
          return;
        }
        setError(data.message ?? "Could not promote this Rule.");
        return;
      }
      router.push(`${basePath}/rules/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (notFound) return <p className="text-sm text-muted-foreground">Rule not found.</p>;
  if (!rule) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const editableVersion = rule.status === "draft" ? rule.currentVersion : draftVersion;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">{rule.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {rule.scope}
            </Badge>
            <StatusBadge status={rule.status} />
            <span className="text-xs text-muted-foreground capitalize">{rule.category.replace(/_/g, " ")}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canPromote && (
            <Button variant="outline" size="sm" disabled={busy} onClick={handlePromote}>
              Promote to Global
            </Button>
          )}
          {canEdit && rule.status === "published" && !draftVersion && (
            <Button variant="outline" size="sm" disabled={busy} onClick={handleCreateNextDraft}>
              Create next draft
            </Button>
          )}
          {canEdit && rule.status !== "archived" && (
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

      {canEdit && editableVersion ? (
        <>
          <RuleForm
            basePath={basePath}
            currentUserId={currentUserId}
            mode="edit"
            ruleId={rule.id}
            ruleVersion={rule.version}
            versionId={editableVersion.id}
            initial={toFormInitial(editableVersion)}
            onSaved={refresh}
          />
          <Button disabled={busy} onClick={() => handlePublish(editableVersion.id)}>
            Publish this draft
          </Button>
        </>
      ) : (
        rule.currentVersion && (
          <Card>
            <CardHeader>
              <CardTitle>Current version (v{rule.currentVersion.versionNumber})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {rule.currentVersion.description && <p className="text-muted-foreground">{rule.currentVersion.description}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Provider message code</p>
                  <p>{rule.currentVersion.providerMessageCode}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Admin message code</p>
                  <p>{rule.currentVersion.adminMessageCode}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Severity</p>
                  <p className="capitalize">{rule.currentVersion.severity}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">HITL policy</p>
                  <p className="capitalize">{rule.currentVersion.hitlPolicy.replace(/_/g, " ")}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Applicability</p>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-2 text-xs">
                  {JSON.stringify(rule.currentVersion.applicability, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Definition</p>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-2 text-xs">
                  {JSON.stringify(rule.currentVersion.definition, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
