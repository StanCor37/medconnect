"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NO_INSURER = "__none__";

interface Insurer {
  id: string;
  name: string;
  country: string;
}

export function SchemeForm({ basePath }: { basePath: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [insurerId, setInsurerId] = useState<string>(NO_INSURER);
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [productLine, setProductLine] = useState("");
  const [productId, setProductId] = useState("");
  const [countryCodes, setCountryCodes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/insurers", { credentials: "include" })
      .then((res) => res.json())
      .then(setInsurers);
  }, []);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/schemes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          scope: "client", // ignored server-side and forced from actor role — see src/lib/schemes/service.ts
          name: name.trim(),
          description: description.trim() || undefined,
          insurerId: insurerId === NO_INSURER ? undefined : insurerId,
          productLine: productLine.trim() || undefined,
          productId: productId.trim() || undefined,
          countryCodes: countryCodes
            .split(",")
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Something went wrong creating this Scheme.");
        return;
      }
      router.push(`${basePath}/schemes/${data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-heading mb-6 text-2xl font-semibold text-foreground">New Scheme</h1>
      <Card>
        <CardHeader>
          <CardTitle>Scheme details</CardTitle>
          <CardDescription>Insurer, product line/ID, and country codes are all optional.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Insurer</Label>
              <Select
                items={[{ label: "None", value: NO_INSURER }, ...insurers.map((i) => ({ label: i.name, value: i.id }))]}
                value={insurerId}
                onValueChange={(v) => setInsurerId(v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INSURER}>None</SelectItem>
                  {insurers.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="productLine">Product line</Label>
                <Input id="productLine" value={productLine} onChange={(e) => setProductLine(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="productId">Product ID</Label>
                <Input id="productId" value={productId} onChange={(e) => setProductId(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="countryCodes">Country codes (comma-separated, e.g. RS, MK)</Label>
              <Input id="countryCodes" value={countryCodes} onChange={(e) => setCountryCodes(e.target.value)} />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create Scheme"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
