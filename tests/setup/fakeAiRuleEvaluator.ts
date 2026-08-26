import type { AiRuleEvaluator, AiRuleEvaluatorInput, AiRuleEvaluatorResult } from "@/lib/ai/aiRuleEvaluator";
import { AiRuleEvaluatorError } from "@/lib/ai/aiRuleEvaluator";
import type { TechnicalErrorCode } from "@/generated/prisma/enums";

/**
 * Same role FakeOcrClient plays for OCR — a real dependency the engine
 * takes explicitly, swapped for a fake in every test except the dedicated
 * real-API file so nothing calls the real Claude API. Default behavior (no
 * canned responses queued) is a needs_review outcome with zero confidence —
 * deliberately not a silent pass/fail, so a forgotten queue entry surfaces
 * as an obviously-wrong assertion rather than a false positive/negative.
 */
export class FakeAiRuleEvaluator implements AiRuleEvaluator {
  public readonly calls: AiRuleEvaluatorInput[] = [];
  private readonly queue: (AiRuleEvaluatorResult | { error: TechnicalErrorCode })[];

  constructor(queue: (AiRuleEvaluatorResult | { error: TechnicalErrorCode })[] = []) {
    this.queue = queue;
  }

  async evaluate(input: AiRuleEvaluatorInput): Promise<AiRuleEvaluatorResult> {
    this.calls.push(input);
    const next = this.queue.shift();
    if (!next) {
      return { outcome: "needs_review", confidence: 0, evidence: [], modelId: "fake", promptVersion: "fake" };
    }
    if ("error" in next) {
      throw new AiRuleEvaluatorError(next.error, `fake error: ${next.error}`);
    }
    return next;
  }
}

export function fakeAiRuleResult(outcome: "pass" | "fail" | "needs_review", confidence = 0.9): AiRuleEvaluatorResult {
  return { outcome, confidence, evidence: [], modelId: "fake", promptVersion: "fake" };
}
