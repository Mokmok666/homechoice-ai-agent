import type { ValidationResult } from "./validation";

export type AIAnalysisAttemptEvent =
  | { attempt: 1 | 2; outcome: "success" }
  | { attempt: 1 | 2; outcome: "parse_failed" }
  | { attempt: 1 | 2; outcome: "validation_failed"; issueCount: number };

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

export function shouldRetryAIAnalysisValidation(issues: string[]): boolean {
  return issues.length > 0 && issues.every((issue) => {
    if (issue === "analysis must omit education when educationNeed is none") return true;
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

    onAttempt?.({
      attempt,
      outcome: "validation_failed",
      issueCount: validation.errors.length,
    });

    if (attempt === 2 || !shouldRetry(validation.errors)) {
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
