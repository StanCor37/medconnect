"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";

interface CaseSummary {
  id: string;
  internalReference: string;
  caseMode: "standalone" | "client_connected";
  status: string;
  clientId: string | null;
  patientReference: string | null;
  serviceType: string | null;
  eventDate: string | null;
  createdAt: string;
}

interface ClientOption {
  id: string;
  legalName: string;
}

export function CaseList() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [clients, setClients] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [casesRes, clientsRes] = await Promise.all([
          fetch("/api/cases", { credentials: "include" }),
          fetch("/api/clients", { credentials: "include" }),
        ]);
        if (!casesRes.ok) throw new Error("Failed to load Cases.");
        const casesData: CaseSummary[] = await casesRes.json();
        const clientsData: ClientOption[] = clientsRes.ok ? await clientsRes.json() : [];
        if (cancelled) return;
        setCases(casesData);
        setClients(Object.fromEntries(clientsData.map((c) => [c.id, c.legalName])));
      } catch {
        if (!cancelled) setError("Something went wrong loading your Cases.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Cases</h1>
        <Button
          nativeButton={false}
          render={
            <Link href="/provider/cases/new">
              <Plus className="size-4" />
              New Case
            </Link>
          }
        />
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!error && cases === null && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {cases !== null && cases.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">No Cases yet.</p>
          <Button
            nativeButton={false}
            render={
              <Link href="/provider/cases/new">
                <Plus className="size-4" />
                New Case
              </Link>
            }
          />
        </div>
      )}

      {cases !== null && cases.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Patient Ref.</TableHead>
                <TableHead>Service Type</TableHead>
                <TableHead>Event Date</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/provider/cases/${c.id}`}
                      className="font-medium text-primary hover:underline underline-offset-4"
                    >
                      {c.internalReference}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.clientId ? (clients[c.clientId] ?? "—") : "Standalone"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.patientReference ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.serviceType ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.eventDate ? new Date(c.eventDate).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
