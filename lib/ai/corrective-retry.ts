import type { ValidationResult } from "./validation";

export type AIAnalysisAttemptEvent =
  | { attempt: 1 | 2; outcome: "success" }
  | { attempt: 1 | 2; outcome: "parse_failed" }
  | { attempt: 1 | 2; outcome: "validation_failed"; issueCount: number; retryable: boolean };

export type ValidationAwareGenerationResult<T> =
  | { success: true; data: T; attempts: 1 | 2 }
  | { success: false; reason: "parse_failed"; attempts: 1 | 2 }
  | { success: false; reason: "validation_failed"; attempts: 1 | 2; issues: string[] };

interface ValidationAwareGenerationOptions<T> {
  initialPrompt: string;
  generate: (prompt: string) => Promise<string>;
  validate: (parsedOutput: unknown) => ValidationResult<T>;
  createCorrectivePrompt: (issues: string[]) => string;
  shouldRetry: (issues: string[]) => boolean;
  onAttempt?: (event: AIAnalysisAttemptEvent) => void;
}

export type SingleRequestGenerationResult<T> = {
  data: T;
  source: "model" | "deterministic_fallback";
  providerCalls: 1 | 2;
  fallbackReason?: "parse_failed" | "validation_exhausted" | "provider_error";
};

interface SingleRequestGenerationOptions<T> extends ValidationAwareGenerationOptions<T> {
  buildFallback: () => T;
  onProviderError?: (error: unknown) => void;
}

export function shouldRetryAIAnalysisValidation(issues: string[]): boolean {
  return issues.length > 0 && issues.every((issue) => {
    if (issue === "analysis must omit education when educationNeed is none") return true;
    if (issue === "analysis.pendingEvidence contains internal product language") return true;
    return issue.startsWith("analysis.decisionSummary ")
      && issue !== "analysis.decisionSummary must be a non-empty string";
  });
}

export async function runValidationAwareGeneration<T>({
  initialPrompt,
  generate,
  validate,
  createCorrectivePrompt,
  shouldRetry,
  onAttempt,
}: ValidationAwareGenerationOptions<T>): Promise<ValidationAwareGenerationResult<T>> {
  let prompt = initialPrompt;

  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    const attempt = attemptNumber as 1 | 2;
    const rawOutput = await generate(prompt);

    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(rawOutput) as unknown;
    } catch {
      onAttempt?.({ attempt, outcome: "parse_failed" });
      return { success: false, reason: "parse_failed", attempts: attempt };
    }

    const validation = validate(parsedOutput);
    if (validation.success) {
      onAttempt?.({ attempt, outcome: "success" });
      return { success: true, data: validation.data, attempts: attempt };
    }

    const retryable = attempt === 1 && shouldRetry(validation.errors);
    onAttempt?.({
      attempt,
      outcome: "validation_failed",
      issueCount: validation.errors.length,
      retryable,
    });

    if (!retryable) {
      return {
        success: false,
        reason: "validation_failed",
        attempts: attempt,
        issues: validation.errors,
      };
    }

    prompt = createCorrectivePrompt(validation.errors);
  }

  throw new Error("AI validation-aware generation exhausted unexpectedly.");
}

/** One frontend request resolves to either a validated model result or a local safe fallback. */
export async function runSingleRequestGeneration<T>({
  buildFallback,
  onProviderError,
  ...generationOptions
}: SingleRequestGenerationOptions<T>): Promise<SingleRequestGenerationResult<T>> {
  let providerCalls = 0;
  let generation: ValidationAwareGenerationResult<T>;
  try {
    generation = await runValidationAwareGeneration({
      ...generationOptions,
      generate: async (prompt) => {
        providerCalls += 1;
        return generationOptions.generate(prompt);
      },
    });
  } catch (error) {
    onProviderError?.(error);
    return {
      data: buildFallback(),
      source: "deterministic_fallback",
      providerCalls: Math.max(1, Math.min(providerCalls, 2)) as 1 | 2,
      fallbackReason: "provider_error",
    };
  }

  if (generation.success) {
    return { data: generation.data, source: "model", providerCalls: generation.attempts };
  }
  return {
    data: buildFallback(),
    source: "deterministic_fallback",
    providerCalls: generation.attempts,
    fallbackReason: generation.reason === "parse_failed" ? "parse_failed" : "validation_exhausted",
  };
}
