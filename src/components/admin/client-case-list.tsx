"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

interface CaseRow {
  id: string;
  internalReference: string;
  status: string;
  patientReference: string | null;
  serviceType: string | null;
}

/** Read-only per spec §17 — Client Admin sees shared Cases, never edits them (that stays the Provider's job). */
export function ClientCaseList() {
  const [cases, setCases] = useState<CaseRow[] | null>(null);

  useEffect(() => {
    fetch("/api/cases", { credentials: "include" })
      .then((res) => res.json())
      .then(setCases);
  }, []);

  return (
    <div>
      <h1 className="font-heading mb-6 text-2xl font-semibold text-foreground">Cases</h1>

      {cases === null && <p className="text-sm text-muted-foreground">Loading...</p>}
      {cases?.length === 0 && <p className="text-sm text-muted-foreground">No Cases have been shared with you yet.</p>}

      {cases && cases.length > 0 && (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {cases.map((c) => (
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
