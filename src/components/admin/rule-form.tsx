"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = [
  "document_requirement",
  "field_extraction",
  "data_consistency",
  "date_validation",
  "eligibility",
  "medical_clause",
  "financial_validation",
  "fraud_indicator",
];
const EXECUTION_TYPES = ["deterministic", "ai_assisted"];
const SEVERITIES = ["info", "warning", "blocking"];
const HITL_POLICIES = ["never", "on_needs_review", "on_fail", "always"];

const DEFINITION_PLACEHOLDER = JSON.stringify(
  { operation: "required_document", parameters: { documentTypePath: "documents.invoice" } },
  null,
  2
);
const APPLICABILITY_PLACEHOLDER = JSON.stringify({ documentTypes: ["invoice"] }, null, 2);

interface RuleFormValues {
  name: string;
  description: string;
  category: string;
  executionType: string;
  severity: string;
  hitlPolicy: string;
  providerMessageCode: string;
  adminMessageCode: string;
  applicability: string;
  definition: string;
}

const EMPTY: RuleFormValues = {
  name: "",
  description: "",
  category: "document_requirement",
  executionType: "deterministic",
  severity: "warning",
  hitlPolicy: "on_needs_review",
  providerMessageCode: "",
  adminMessageCode: "",
  applicability: "{}",
  definition: "",
};

interface RuleFormProps {
  basePath: string;
  currentUserId: string;
  mode: "create" | "edit";
  ruleId?: string;
  ruleVersion?: number;
  versionId?: string;
  initial?: Partial<RuleFormValues>;
  onSaved?: () => void;
}

export function RuleForm({ basePath, currentUserId, mode, ruleId, ruleVersion, versionId, initial, onSaved }: RuleFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<RuleFormValues>({ ...EMPTY, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof RuleFormValues>(key: K, value: RuleFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function parseJsonField(raw: string, label: string): unknown {
    try {
      return raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${label} must be valid JSON.`);
    }
  }

  async function submit(confirmOverride: boolean) {
    setError(null);
    let definition: unknown;
    let applicability: unknown;
    try {
      definition = parseJsonField(values.definition, "Definition");
      applicability = parseJsonField(values.applicability, "Applicability");
    } catch (e) {
      setError((e as Error).message);
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await fetch("/api/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            scope: "client", // ignored server-side and forced from actor role — see src/lib/rules/service.ts
            name: values.name.trim(),
            description: values.description.trim() || undefined,
            category: values.category,
            executionType: values.executionType,
            definition,
            applicability,
            providerMessageCode: values.providerMessageCode.trim(),
            adminMessageCode: values.adminMessageCode.trim(),
            severity: values.severity,
            hitlPolicy: values.hitlPolicy,
            ...(confirmOverride ? { confirmedNotDuplicateBy: currentUserId } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.error === "probable_duplicate_rule") {
            setDuplicateWarning(data.message);
            return;
          }
          setError(data.message ?? "Something went wrong creating this Rule.");
          return;
        }
        router.push(`${basePath}/rules/${data.id}`);
      } else {
        const res = await fetch(`/api/rules/${ruleId}/versions/${versionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            version: ruleVersion,
            name: values.name.trim(),
            description: values.description.trim() || null,
            definition,
            applicability,
            providerMessageCode: values.providerMessageCode.trim(),
            adminMessageCode: values.adminMessageCode.trim(),
            severity: values.severity,
            hitlPolicy: values.hitlPolicy,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.message ?? "Something went wrong saving this draft.");
          return;
        }
        onSaved?.();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "create" ? "New Rule" : "Edit draft version"}</CardTitle>
        <CardDescription>
          Definition and applicability are raw JSON matching the shapes documented in
          src/lib/validation/rule.ts.
        </CardDescription>
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
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={values.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>Category</Label>
              {mode === "create" ? (
                <Select
                  items={CATEGORIES.map((c) => ({ label: c.replace(/_/g, " "), value: c }))}
                  value={values.category}
                  onValueChange={(v) => set("category", v as string)}
                >
                  <SelectTrigger className="w-full capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="flex h-8 items-center text-sm text-muted-foreground capitalize">
                  {values.category.replace(/_/g, " ")} (fixed after creation)
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label>Execution type</Label>
              {mode === "create" ? (
                <Select
                  items={EXECUTION_TYPES.map((c) => ({ label: c.replace(/_/g, " "), value: c }))}
                  value={values.executionType}
                  onValueChange={(v) => set("executionType", v as string)}
                >
                  <SelectTrigger className="w-full capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXECUTION_TYPES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="flex h-8 items-center text-sm text-muted-foreground capitalize">
                  {values.executionType.replace(/_/g, " ")} (fixed after creation)
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>Severity</Label>
              <Select
                items={SEVERITIES.map((c) => ({ label: c, value: c }))}
                value={values.severity}
                onValueChange={(v) => set("severity", v as string)}
              >
                <SelectTrigger className="w-full capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>HITL policy</Label>
              <Select
                items={HITL_POLICIES.map((c) => ({ label: c.replace(/_/g, " "), value: c }))}
                value={values.hitlPolicy}
                onValueChange={(v) => set("hitlPolicy", v as string)}
              >
                <SelectTrigger className="w-full capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HITL_POLICIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="providerMessageCode">Provider message code</Label>
              <Input
                id="providerMessageCode"
                value={values.providerMessageCode}
                onChange={(e) => set("providerMessageCode", e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="adminMessageCode">Admin message code</Label>
              <Input
                id="adminMessageCode"
                value={values.adminMessageCode}
                onChange={(e) => set("adminMessageCode", e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="applicability">Applicability (JSON)</Label>
            <Textarea
              id="applicability"
              value={values.applicability}
              onChange={(e) => set("applicability", e.target.value)}
              placeholder={APPLICABILITY_PLACEHOLDER}
              rows={3}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="definition">Definition (JSON)</Label>
            <Textarea
              id="definition"
              value={values.definition}
              onChange={(e) => set("definition", e.target.value)}
              placeholder={DEFINITION_PLACEHOLDER}
              rows={6}
              className="font-mono text-xs"
              required={mode === "create"}
            />
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
            {submitting ? "Saving..." : mode === "create" ? "Create Rule" : "Save draft"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
