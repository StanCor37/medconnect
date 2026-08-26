import Anthropic from "@anthropic-ai/sdk";
import {
  aiRuleOutputSchema,
  aiRuleOutputToolInputSchema,
  AI_RULE_OUTPUT_TOOL_NAME,
} from "@/lib/validation/aiRuleOutput";
import { AiRuleEvaluatorError, type AiRuleEvaluator, type AiRuleEvaluatorInput, type AiRuleEvaluatorResult } from "@/lib/ai/aiRuleEvaluator";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
// Bumped only when the prompt template's own structure/wording changes —
// never the literal prompt text, which is never persisted (spec §13/§29).
const PROMPT_VERSION = "v1";
const CALL_TIMEOUT_MS = 20_000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function buildPrompt(input: AiRuleEvaluatorInput): string {
  const evidenceBlocks = input.evidenceText
    .map((e) => `--- Document: ${e.documentTypeCode} (version ${e.documentVersionId}, page ${e.pageNumber}) ---\n${e.text}`)
    .join("\n\n");
  return [
    "You are evaluating one insurance-claim validation rule against the evidence below.",
    "Answer strictly using only the evidence provided — never assume information that is not present.",
    "",
    `Question: ${input.evaluationQuestion}`,
    input.evidenceRequirements.length > 0 ? `Required evidence types: ${input.evidenceRequirements.join(", ")}` : "",
    "",
    "Evidence:",
    evidenceBlocks || "(no evidence text available)",
    "",
    `Call the ${AI_RULE_OUTPUT_TOOL_NAME} tool with your answer. If the evidence is insufficient or ambiguous, use outcome "needs_review" rather than guessing.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Real, native-Claude-API implementation. Never persists the prompt or raw
 * model text anywhere (spec §13/§29) — only the tiny, Zod-validated
 * AiRuleOutput shape ever leaves this function.
 */
export class ClaudeAiRuleEvaluator implements AiRuleEvaluator {
  async evaluate(input: AiRuleEvaluatorInput): Promise<AiRuleEvaluatorResult> {
    let message;
    try {
      message = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 4096,
          tools: [
            {
              name: AI_RULE_OUTPUT_TOOL_NAME,
              description: "Record the structured outcome of this rule evaluation.",
              input_schema: aiRuleOutputToolInputSchema,
              strict: true,
            },
          ],
          tool_choice: { type: "tool", name: AI_RULE_OUTPUT_TOOL_NAME },
          messages: [{ role: "user", content: buildPrompt(input) }],
        },
        { timeout: CALL_TIMEOUT_MS }
      );
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        throw new AiRuleEvaluatorError("model_timeout", "Claude API call timed out");
      }
      if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) {
        throw new AiRuleEvaluatorError("rule_engine_error", `Claude API error: ${err.message}`);
      }
      throw new AiRuleEvaluatorError("rule_engine_error", `Unexpected error calling Claude: ${(err as Error).message}`);
    }

    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse) {
      throw new AiRuleEvaluatorError("invalid_model_output", "Claude did not return a tool_use block");
    }

    const parsed = aiRuleOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new AiRuleEvaluatorError("invalid_model_output", `Claude's tool input failed validation: ${parsed.error.message}`);
    }

    return { ...parsed.data, modelId: MODEL, promptVersion: PROMPT_VERSION };
  }
}

let singleton: AiRuleEvaluator | null = null;

export function getDefaultAiRuleEvaluator(): AiRuleEvaluator {
  singleton ??= new ClaudeAiRuleEvaluator();
  return singleton;
}
