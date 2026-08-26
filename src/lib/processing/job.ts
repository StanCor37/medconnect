import crypto from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { ProcessingJobTask } from "@/generated/prisma/enums";

export function hashProcessingInput(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join(":")).digest("hex");
}

/**
 * The compound key doubles as spec §24's cache — a "completed" row for the
 * same (documentVersionId, task, inputVersionHash) means the exact same
 * work was already done, so it's skipped rather than redone. Never rethrows
 * — a pipeline failure must not fail the parent upload/confirm-type request
 * (spec: "manual continuation must remain available when automation
 * fails"). Callers (classification.ts/extraction.ts) don't need their own
 * try/catch as a result.
 */
export async function withProcessingJob(
  tx: Prisma.TransactionClient,
  documentVersionId: string,
  task: ProcessingJobTask,
  inputVersionHash: string,
  fn: () => Promise<void>
): Promise<void> {
  const existing = await tx.documentProcessingJob.findUnique({
    where: { documentVersionId_task_inputVersionHash: { documentVersionId, task, inputVersionHash } },
  });
  if (existing?.status === "completed") return;

  const job = await tx.documentProcessingJob.upsert({
    where: { documentVersionId_task_inputVersionHash: { documentVersionId, task, inputVersionHash } },
    create: {
      documentVersionId,
      task,
      inputVersionHash,
      status: "processing",
      processor: "internal",
      startedAt: new Date(),
    },
    update: { status: "processing", attempt: { increment: 1 }, startedAt: new Date(), completedAt: null, errorCode: null },
  });

  try {
    await fn();
    await tx.documentProcessingJob.update({
      where: { id: job.id },
      data: { status: "completed", completedAt: new Date() },
    });
  } catch {
    await tx.documentProcessingJob.update({
      where: { id: job.id },
      data: { status: "failed", completedAt: new Date(), errorCode: "processing_failed" },
    });
  }
}
