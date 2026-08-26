"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

interface SchemeRow {
  id: string;
  name: string;
  scope: "global" | "client";
  status: string;
  productLine: string | null;
  currentVersion: { versionNumber: number } | null;
}

export function SchemesList({ basePath }: { basePath: string }) {
  const [schemes, setSchemes] = useState<SchemeRow[] | null>(null);

  useEffect(() => {
    fetch("/api/schemes", { credentials: "include" })
      .then((res) => res.json())
      .then(setSchemes);
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Schemes</h1>
        <Button
          nativeButton={false}
          render={
            <Link href={`${basePath}/schemes/new`}>
              <Plus className="size-4" />
              New Scheme
            </Link>
          }
        />
      </div>

      {schemes === null && <p className="text-sm text-muted-foreground">Loading...</p>}
      {schemes?.length === 0 && <p className="text-sm text-muted-foreground">No Schemes yet.</p>}

      {schemes && schemes.length > 0 && (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {schemes.map((scheme) => (
              <Link
                key={scheme.id}
                href={`${basePath}/schemes/${scheme.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
              >
                <div>
                  <p className="font-medium text-foreground">{scheme.name}</p>
                  {scheme.productLine && <p className="text-sm text-muted-foreground">{scheme.productLine}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {scheme.scope}
                  </Badge>
                  <StatusBadge status={scheme.status} />
                  {scheme.currentVersion && (
                    <span className="text-xs text-muted-foreground">v{scheme.currentVersion.versionNumber}</span>
                  )}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
