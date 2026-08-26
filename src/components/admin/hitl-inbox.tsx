"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

interface HitlTaskRow {
  id: string;
  version: number;
  status: string;
  reasonCode: string;
  case: { id: string; internalReference: string };
  ruleResult: { outcome: string; ruleVersion: { name: string } };
}

const DECISIONS = [
  { value: "confirm", label: "Confirm", needsReason: false },
  { value: "override_to_pass", label: "Override → Pass", needsReason: true },
  { value: "override_to_fail", label: "Override → Fail", needsReason: true },
  { value: "request_documents", label: "Request Documents", needsReason: false },
  { value: "return_to_provider", label: "Return to Provider", needsReason: false },
] as const;

/** The 5 decision types from spec §19, reason required for both override options. */
export function HitlInbox() {
  const [tasks, setTasks] = useState<HitlTaskRow[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/hitl-tasks?status=open", { credentials: "include" });
      if (!res.ok || cancelled) return;
      setTasks(await res.json());
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  async function decide(task: HitlTaskRow, decision: (typeof DECISIONS)[number]["value"]) {
    setError(null);
    setBusyId(task.id);
    try {
      const res = await fetch(`/api/hitl-tasks/${task.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: task.version, decision, reason: reasons[task.id]?.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not record this decision.");
        return;
      }
      setRefreshToken((t) => t + 1);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="font-heading mb-6 text-2xl font-semibold text-foreground">HITL Review</h1>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {tasks === null && <p className="text-sm text-muted-foreground">Loading...</p>}
      {tasks?.length === 0 && <p className="text-sm text-muted-foreground">No open review tasks.</p>}

      <div className="flex flex-col gap-4">
        {tasks?.map((task) => (
          <Card key={task.id}>
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Link href={`/admin/cases/${task.case.id}`} className="font-medium text-foreground hover:underline">
                    {task.case.internalReference}
                  </Link>
                  <p className="text-sm text-muted-foreground">{task.ruleResult.ruleVersion.name}</p>
                </div>
                <StatusBadge status={task.ruleResult.outcome} />
              </div>
              <p className="text-xs text-muted-foreground">{task.reasonCode.replace(/_/g, " ")}</p>

              <Textarea
                placeholder="Reason (required for Override decisions)"
                value={reasons[task.id] ?? ""}
                onChange={(e) => setReasons((prev) => ({ ...prev, [task.id]: e.target.value }))}
                rows={2}
              />
              <div className="flex flex-wrap gap-2">
                {DECISIONS.map((d) => (
                  <Button
                    key={d.value}
                    size="sm"
                    variant={d.value.startsWith("override") ? "destructive" : "outline"}
                    disabled={busyId === task.id || (d.needsReason && !reasons[task.id]?.trim())}
                    onClick={() => decide(task, d.value)}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
