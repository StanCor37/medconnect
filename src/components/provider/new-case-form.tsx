"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NO_CLIENT = "__standalone__";

interface ClientOption {
  id: string;
  legalName: string;
}
interface RelationshipSummary {
  clientId: string;
  status: string;
}

export function NewCaseForm({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const [patientReference, setPatientReference] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [clientId, setClientId] = useState<string>(NO_CLIENT);
  const [activeClients, setActiveClients] = useState<ClientOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const [relRes, clientsRes] = await Promise.all([
        fetch("/api/provider-client-relationships", { credentials: "include" }),
        fetch("/api/clients", { credentials: "include" }),
      ]);
      if (!relRes.ok || !clientsRes.ok) return;
      const relationships: RelationshipSummary[] = await relRes.json();
      const clients: ClientOption[] = await clientsRes.json();
      const activeIds = new Set(relationships.filter((r) => r.status === "active").map((r) => r.clientId));
      setActiveClients(clients.filter((c) => activeIds.has(c.id)));
    }
    load();
  }, []);

  function buildBody(confirmOverride: boolean) {
    return {
      patientReference: patientReference.trim() || undefined,
      serviceType: serviceType.trim() || undefined,
      eventDate: eventDate || undefined,
      clientId: clientId === NO_CLIENT ? undefined : clientId,
      ...(confirmOverride ? { confirmedNotDuplicateBy: currentUserId } : {}),
    };
  }

  async function submit(confirmOverride: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(buildBody(confirmOverride)),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "probable_duplicate_case") {
          setDuplicateWarning(data.message);
          return;
        }
        setError(data.message ?? "Something went wrong creating this Case.");
        return;
      }
      router.push(`/provider/cases/${data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-heading mb-6 text-2xl font-semibold text-foreground">New Case</h1>
      <Card>
        <CardHeader>
          <CardTitle>Case details</CardTitle>
          <CardDescription>Patient reference, service type, and event date are all optional.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(false);
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="patientReference">Patient reference</Label>
              <Input id="patientReference" value={patientReference} onChange={(e) => setPatientReference(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="serviceType">Service type</Label>
              <Input id="serviceType" value={serviceType} onChange={(e) => setServiceType(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="eventDate">Event date</Label>
              <Input id="eventDate" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Share with Client</Label>
              <Select
                items={[{ label: "Standalone (no Client)", value: NO_CLIENT }, ...activeClients.map((c) => ({ label: c.legalName, value: c.id }))]}
                value={clientId}
                onValueChange={(v) => setClientId(v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Standalone (no Client)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>Standalone (no Client)</SelectItem>
                  {activeClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {duplicateWarning && (
              <Alert>
                <AlertDescription>
                  {duplicateWarning}
                  <div className="mt-2">
                    <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => submit(true)}>
                      Create anyway
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create Case"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
