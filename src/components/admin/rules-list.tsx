"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

interface RuleRow {
  id: string;
  name: string;
  category: string;
  scope: "global" | "client";
  status: string;
  currentVersion: { versionNumber: number } | null;
}

export function RulesList({ basePath }: { basePath: string }) {
  const [rules, setRules] = useState<RuleRow[] | null>(null);

  useEffect(() => {
    fetch("/api/rules", { credentials: "include" })
      .then((res) => res.json())
      .then(setRules);
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Rules</h1>
        <Button
          nativeButton={false}
          render={
            <Link href={`${basePath}/rules/new`}>
              <Plus className="size-4" />
              New Rule
            </Link>
          }
        />
      </div>

      {rules === null && <p className="text-sm text-muted-foreground">Loading...</p>}
      {rules?.length === 0 && <p className="text-sm text-muted-foreground">No Rules yet.</p>}

      {rules && rules.length > 0 && (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {rules.map((rule) => (
              <Link
                key={rule.id}
                href={`${basePath}/rules/${rule.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
              >
                <div>
                  <p className="font-medium text-foreground">{rule.name}</p>
                  <p className="text-sm text-muted-foreground capitalize">{rule.category.replace(/_/g, " ")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {rule.scope}
                  </Badge>
                  <StatusBadge status={rule.status} />
                  {rule.currentVersion && (
                    <span className="text-xs text-muted-foreground">v{rule.currentVersion.versionNumber}</span>
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
