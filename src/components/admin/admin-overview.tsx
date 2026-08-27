"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";

interface Trend {
  current: number;
  previous: number;
  trend: number | null;
}

interface Kpis {
  openCases: number;
  providerAction: number;
  clientReview: number;
  validated: Trend;
  submitted: Trend;
  accepted: Trend;
  rejected: Trend;
  liquidated: Trend;
  avgReviewTimeMs: number | null;
}

interface QueueItem {
  caseId: string;
  internalReference: string;
  since: string;
}

interface Queue {
  total: number;
  items: QueueItem[];
}

interface HitlOutcomes {
  totalDecisions: number;
  overrideRate: number | null;
  confirmationRate: number | null;
}

interface DocumentIssue {
  documentTypeCode: string;
  missingCount: number;
}

interface DocumentIssues {
  issues: DocumentIssue[];
  unreadableRate: number | null;
}

type SectionResult<T> = T | { error: true };

interface OverviewResponse {
  period: { key: string; from: string; to: string; label: string };
  lastUpdated: string;
  sections: {
    kpis: SectionResult<Kpis>;
    statusDistribution: SectionResult<Record<string, number>>;
    ageBuckets: SectionResult<Record<string, number>>;
    needsReview: SectionResult<Queue>;
    waitingForProvider: SectionResult<Queue>;
    hitlOutcomes: SectionResult<HitlOutcomes>;
    documentIssues: SectionResult<DocumentIssues>;
  };
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const AGE_BUCKET_ORDER = ["<24h", "1-3d", "3-7d", "7-14d", "14-30d", ">30d"];

function isError(value: unknown): value is { error: true } {
  return typeof value === "object" && value !== null && "error" in value && (value as { error: unknown }).error === true;
}

function formatTrend(t: Trend): string {
  if (t.trend === null) return "No previous-period comparison";
  const pct = Math.round(t.trend * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% vs previous period`;
}

function formatPercent(x: number | null): string {
  return x === null ? "—" : `${Math.round(x * 100)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(ms / (1000 * 60))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function SectionError() {
  return (
    <Alert variant="destructive">
      <AlertDescription>This section could not be loaded. Try again.</AlertDescription>
    </Alert>
  );
}

function Bar({ label, count, max }: { label: string; count: number; max: number }) {
  const width = max === 0 ? 0 : Math.max((count / max) * 100, count > 0 ? 4 : 0);
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-40 shrink-0">
        <StatusBadge status={label} />
      </div>
      <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-secondary">
        <div className="h-full rounded-md bg-muted-foreground/40" style={{ width: `${width}%` }} />
      </div>
      <div className="w-8 shrink-0 text-right text-muted-foreground">{count}</div>
    </div>
  );
}

export function AdminOverview() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setData(null);
      setLoadError(null);
      try {
        const res = await fetch(`/api/analytics/overview?period=${period}`, { credentials: "include" });
        if (!res.ok) throw new Error("failed");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setLoadError("Something went wrong loading your dashboard.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [period]);

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-48">
          <Select items={PERIOD_OPTIONS} value={period} onValueChange={(v) => setPeriod(v as string)}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data && <p className="text-xs text-muted-foreground">Last updated: {new Date(data.lastUpdated).toLocaleString()}</p>}
      </div>

      {/* KPIs */}
      <div>
        {data === null && <Skeleton className="h-28 w-full" />}
        {data && isError(data.sections.kpis) && <SectionError />}
        {data && !isError(data.sections.kpis) && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(
              [
                { title: "Open Cases", value: data.sections.kpis.openCases, snapshot: true },
                { title: "Provider Action", value: data.sections.kpis.providerAction, snapshot: true },
                { title: "Client Review", value: data.sections.kpis.clientReview, snapshot: true },
                { title: "Validated Cases", trend: data.sections.kpis.validated },
                { title: "Submitted Cases", trend: data.sections.kpis.submitted },
                { title: "Accepted Cases", trend: data.sections.kpis.accepted },
                { title: "Rejected Cases", trend: data.sections.kpis.rejected },
                { title: "Liquidated Cases", trend: data.sections.kpis.liquidated },
              ] as const
            ).map((k) => (
              <Card key={k.title}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">
                    {k.title} {"snapshot" in k && k.snapshot ? "· now" : `· ${data.period.label.toLowerCase()}`}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{"snapshot" in k ? k.value : k.trend.current}</p>
                  {"trend" in k && <p className="mt-1 text-xs text-muted-foreground">{formatTrend(k.trend)}</p>}
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Average Client Review Time · {data.period.label.toLowerCase()}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{formatDuration(data.sections.kpis.avgReviewTimeMs)}</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cases by status */}
        <Card>
          <CardHeader>
            <CardTitle>Cases by status</CardTitle>
          </CardHeader>
          <CardContent>
            {data === null && <Skeleton className="h-40 w-full" />}
            {data && isError(data.sections.statusDistribution) && <SectionError />}
            {data && !isError(data.sections.statusDistribution) && (
              <>
                {Object.keys(data.sections.statusDistribution).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No Cases match the selected filters.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {Object.entries(data.sections.statusDistribution)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => (
                        <Link key={status} href={`/admin/cases?status=${status}`} className="rounded-md transition-colors hover:bg-accent">
                          <Bar
                            label={status}
                            count={count}
                            max={Math.max(...Object.values(data.sections.statusDistribution as Record<string, number>))}
                          />
                        </Link>
                      ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Case age */}
        <Card>
          <CardHeader>
            <CardTitle>Case age</CardTitle>
          </CardHeader>
          <CardContent>
            {data === null && <Skeleton className="h-40 w-full" />}
            {data && isError(data.sections.ageBuckets) && <SectionError />}
            {data &&
              !isError(data.sections.ageBuckets) &&
              (() => {
                const ageBuckets: Record<string, number> = data.sections.ageBuckets;
                const maxCount = Math.max(...Object.values(ageBuckets));
                return (
                  <div className="flex flex-col gap-2">
                    {AGE_BUCKET_ORDER.map((bucket) => {
                      const count = ageBuckets[bucket];
                      const width = maxCount === 0 ? 0 : Math.max((count / maxCount) * 100, count > 0 ? 4 : 0);
                      return (
                        <div key={bucket} className="flex items-center gap-3 text-sm">
                          <div className="w-16 shrink-0 text-muted-foreground">{bucket}</div>
                          <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-secondary">
                            <div className="h-full rounded-md bg-muted-foreground/40" style={{ width: `${width}%` }} />
                          </div>
                          <div className="w-8 shrink-0 text-right text-muted-foreground">{count}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
          </CardContent>
        </Card>

        {/* Needs my review */}
        <Card>
          <CardHeader>
            <CardTitle>Needs my review</CardTitle>
          </CardHeader>
          <CardContent>
            {data === null && <Skeleton className="h-24 w-full" />}
            {data && isError(data.sections.needsReview) && <SectionError />}
            {data && !isError(data.sections.needsReview) && (
              <>
                {data.sections.needsReview.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No Cases currently require Client review.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {data.sections.needsReview.items.map((item) => (
                      <li key={item.caseId} className="flex items-center justify-between py-2 text-sm">
                        <Link href="/admin/hitl" className="font-medium text-foreground hover:underline">
                          {item.internalReference}
                        </Link>
                        <span className="text-muted-foreground">{formatAge(item.since)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {data.sections.needsReview.total > data.sections.needsReview.items.length && (
                  <Link href="/admin/hitl" className="mt-2 block text-xs text-primary hover:underline">
                    View all {data.sections.needsReview.total}
                  </Link>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Waiting for Provider */}
        <Card>
          <CardHeader>
            <CardTitle>Waiting for Provider</CardTitle>
          </CardHeader>
          <CardContent>
            {data === null && <Skeleton className="h-24 w-full" />}
            {data && isError(data.sections.waitingForProvider) && <SectionError />}
            {data && !isError(data.sections.waitingForProvider) && (
              <>
                {data.sections.waitingForProvider.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No connected Providers have shared Cases during this period.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {data.sections.waitingForProvider.items.map((item) => (
                      <li key={item.caseId} className="flex items-center justify-between py-2 text-sm">
                        <Link href={`/admin/cases/${item.caseId}`} className="font-medium text-foreground hover:underline">
                          {item.internalReference}
                        </Link>
                        <span className="text-muted-foreground">{formatAge(item.since)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {data.sections.waitingForProvider.total > data.sections.waitingForProvider.items.length && (
                  <Link
                    href="/admin/cases?status=provider_action_required"
                    className="mt-2 block text-xs text-primary hover:underline"
                  >
                    View all {data.sections.waitingForProvider.total}
                  </Link>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* HITL outcomes */}
        <Card>
          <CardHeader>
            <CardTitle>HITL outcomes</CardTitle>
          </CardHeader>
          <CardContent>
            {data === null && <Skeleton className="h-24 w-full" />}
            {data && isError(data.sections.hitlOutcomes) && <SectionError />}
            {data && !isError(data.sections.hitlOutcomes) && (
              <>
                {data.sections.hitlOutcomes.totalDecisions === 0 ? (
                  <p className="text-sm text-muted-foreground">No AI processing usage was recorded during this period.</p>
                ) : (
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Override rate</dt>
                      <dd className="font-medium text-foreground">{formatPercent(data.sections.hitlOutcomes.overrideRate)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Confirmation rate</dt>
                      <dd className="font-medium text-foreground">{formatPercent(data.sections.hitlOutcomes.confirmationRate)}</dd>
                    </div>
                  </dl>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Top document issues */}
        <Card>
          <CardHeader>
            <CardTitle>Top document issues</CardTitle>
          </CardHeader>
          <CardContent>
            {data === null && <Skeleton className="h-24 w-full" />}
            {data && isError(data.sections.documentIssues) && <SectionError />}
            {data && !isError(data.sections.documentIssues) && (
              <div className="flex flex-col gap-3">
                {data.sections.documentIssues.issues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No Cases match the selected filters.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {data.sections.documentIssues.issues.map((issue) => (
                      <li key={issue.documentTypeCode} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-foreground capitalize">{issue.documentTypeCode.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">{issue.missingCount} missing</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  Unreadable rate ({data.period.label.toLowerCase()}): {formatPercent(data.sections.documentIssues.unreadableRate)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
