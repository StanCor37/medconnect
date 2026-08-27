"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

interface AccountRow {
  id: string;
  email: string;
  role: "client_admin" | "provider_user";
  status: "invited" | "active" | "suspended" | "deactivated";
  firstName: string;
  lastName: string;
  providerId: string | null;
  clientId: string | null;
  provider: { legalName: string } | null;
  client: { legalName: string } | null;
}

const ROLE_LABELS: Record<AccountRow["role"], string> = {
  client_admin: "Client Admins",
  provider_user: "Provider Users",
};

export function AccountList({ basePath }: { basePath: string }) {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/accounts", { credentials: "include" });
      if (!res.ok || cancelled) return;
      setAccounts(await res.json());
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  async function performAction(userId: string, action: "resend-invite" | "suspend" | "deactivate") {
    setError(null);
    setBusyId(userId);
    try {
      const res = await fetch(`/api/accounts/${userId}/${action}`, { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "That action could not be completed.");
        return;
      }
      setRefreshToken((t) => t + 1);
    } finally {
      setBusyId(null);
    }
  }

  const groups: AccountRow["role"][] = ["client_admin", "provider_user"];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Accounts</h1>
        <Button
          nativeButton={false}
          render={
            <Link href={`${basePath}/accounts/new`}>
              <Plus className="size-4" />
              Invite user
            </Link>
          }
        />
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {accounts === null && <p className="text-sm text-muted-foreground">Loading...</p>}
      {accounts?.length === 0 && <p className="text-sm text-muted-foreground">No accounts yet.</p>}

      {accounts && accounts.length > 0 && (
        <div className="flex flex-col gap-6">
          {groups.map((role) => {
            const rows = accounts.filter((a) => a.role === role);
            if (rows.length === 0) return null;
            return (
              <div key={role}>
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">{ROLE_LABELS[role]}</h2>
                <Card>
                  <CardContent className="divide-y divide-border p-0">
                    {rows.map((a) => (
                      <div key={a.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-foreground">
                            {a.firstName} {a.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {a.email}
                            {a.provider ? ` · ${a.provider.legalName}` : a.client ? ` · ${a.client.legalName}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={a.status} />
                          {a.status === "invited" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === a.id}
                              onClick={() => performAction(a.id, "resend-invite")}
                            >
                              {busyId === a.id ? "Resending..." : "Resend invite"}
                            </Button>
                          )}
                          {a.status === "active" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === a.id}
                              onClick={() => performAction(a.id, "suspend")}
                            >
                              {busyId === a.id ? "Suspending..." : "Suspend"}
                            </Button>
                          )}
                          {(a.status === "active" || a.status === "suspended") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              disabled={busyId === a.id}
                              onClick={() => performAction(a.id, "deactivate")}
                            >
                              {busyId === a.id ? "Deactivating..." : "Deactivate"}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
