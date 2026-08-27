"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

interface CaseRow {
  id: string;
  internalReference: string;
  status: string;
  patientReference: string | null;
  serviceType: string | null;
}

/**
 * Read-only per spec §17 — Client Admin sees shared Cases, never edits them
 * (that stays the Provider's job). The `status` search param is a drill-down
 * from the Segment 9 Overview dashboard: `GET /api/cases` stays fully
 * unfiltered (also used by the Provider side), so the filter is applied
 * client-side against the already-fetched list rather than as a new backend
 * query param.
 */
export function ClientCaseList() {
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status");

  useEffect(() => {
    fetch("/api/cases", { credentials: "include" })
      .then((res) => res.json())
      .then(setCases);
  }, []);

  const visibleCases = statusFilter ? cases?.filter((c) => c.status === statusFilter) : cases;

  return (
    <div>
      <h1 className="font-heading mb-6 text-2xl font-semibold text-foreground">Cases</h1>

      {statusFilter && (
        <button
          type="button"
          onClick={() => router.push("/admin/cases")}
          className="mb-4 inline-flex items-center gap-1.5 rounded-4xl border border-border bg-secondary px-3 py-1 text-sm text-secondary-foreground transition-colors hover:bg-accent"
        >
          Filtered by: {statusFilter.replace(/_/g, " ")}
          <X className="size-3.5" />
        </button>
      )}

      {cases === null && <p className="text-sm text-muted-foreground">Loading...</p>}
      {cases?.length === 0 && <p className="text-sm text-muted-foreground">No Cases have been shared with you yet.</p>}
      {cases && cases.length > 0 && visibleCases?.length === 0 && (
        <p className="text-sm text-muted-foreground">No Cases match the selected filters.</p>
      )}

      {visibleCases && visibleCases.length > 0 && (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {visibleCases.map((c) => (
              <Link
                key={c.id}
                href={`/admin/cases/${c.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
              >
                <div>
                  <p className="font-medium text-foreground">{c.internalReference}</p>
                  <p className="text-sm text-muted-foreground">{c.patientReference ?? c.serviceType ?? "—"}</p>
                </div>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
