"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Role = "client_admin" | "provider_user";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "client_admin", label: "Client Admin" },
  { value: "provider_user", label: "Provider User" },
];

interface ProviderOption {
  id: string;
  legalName: string;
  mode: "standalone" | "client_connected";
  createdBySuperAdminId: string | null;
}

interface ClientOption {
  id: string;
  legalName: string;
}

interface AccountFormProps {
  basePath: string;
  allowedRoles: Role[];
}

export function AccountForm({ basePath, allowedRoles }: AccountFormProps) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(allowedRoles[0]);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [providerId, setProviderId] = useState("");
  const [clientId, setClientId] = useState("");
  const [providers, setProviders] = useState<ProviderOption[] | null>(null);
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ devTempPassword?: string } | null>(null);

  useEffect(() => {
    if (role === "provider_user" && providers === null) {
      fetch("/api/providers", { credentials: "include" })
        .then((res) => res.json())
        .then(setProviders);
    }
    if (role === "client_admin" && clients === null) {
      fetch("/api/clients", { credentials: "include" })
        .then((res) => res.json())
        .then(setClients);
    }
  }, [role, providers, clients]);

  // Super Admin may only target a standalone Provider that some Super Admin
  // already created (assertCanCreateAccountFor's real rule) — filtered here
  // so the picker never offers an option that would 403 on submit. Client
  // Admin's own /api/providers response is already scoped to actively-
  // connected Providers only, so it's used as-is.
  const providerOptions =
    basePath === "/super-admin"
      ? (providers ?? []).filter((p) => p.mode === "standalone" && p.createdBySuperAdminId !== null)
      : (providers ?? []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          role,
          providerId: role === "provider_user" ? providerId : undefined,
          clientId: role === "client_admin" ? clientId : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "That account could not be created.");
        return;
      }
      setResult(data);
      setEmail("");
      setFirstName("");
      setLastName("");
      setProviderId("");
      setClientId("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite user</CardTitle>
        <CardDescription>They&rsquo;ll receive a temporary password and set their own on first login.</CardDescription>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="flex flex-col gap-4">
            <Alert>
              <AlertDescription>
                {result.devTempPassword
                  ? `Invitation created. Temporary password: ${result.devTempPassword} — share this with the new user.`
                  : "Invitation sent."}
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setResult(null)}>
                Invite another
              </Button>
              <Button variant="outline" onClick={() => router.push(`${basePath}/accounts`)}>
                Back to Accounts
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {allowedRoles.length > 1 && (
              <div className="flex flex-col gap-2">
                <Label>Role</Label>
                <Select
                  items={ROLE_OPTIONS.filter((o) => allowedRoles.includes(o.value))}
                  value={role}
                  onValueChange={(v) => setRole(v as Role)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.filter((o) => allowedRoles.includes(o.value)).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>

            {role === "provider_user" && (
              <div className="flex flex-col gap-2">
                <Label>Provider</Label>
                <Select
                  items={providerOptions.map((p) => ({ label: p.legalName, value: p.id }))}
                  value={providerId}
                  onValueChange={(v) => setProviderId(v as string)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providerOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.legalName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {providers !== null && providerOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {basePath === "/super-admin"
                      ? "No standalone Providers are available. Create one first."
                      : "No connected Providers are available."}
                  </p>
                )}
              </div>
            )}

            {role === "client_admin" && (
              <div className="flex flex-col gap-2">
                <Label>Client</Label>
                <Select
                  items={(clients ?? []).map((c) => ({ label: c.legalName, value: c.id }))}
                  value={clientId}
                  onValueChange={(v) => setClientId(v as string)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a Client" />
                  </SelectTrigger>
                  <SelectContent>
                    {(clients ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.legalName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={
                submitting || (role === "provider_user" && !providerId) || (role === "client_admin" && !clientId)
              }
            >
              {submitting ? "Inviting..." : "Send invite"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
