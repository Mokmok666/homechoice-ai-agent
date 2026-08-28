import assert from "node:assert/strict";
import { runValidationAwareGeneration, shouldRetryAIAnalysisValidation } from "../lib/ai/corrective-retry";
import { validateAIAnalysisResponse, type AINarrativeConsistencyConstraint } from "../lib/ai/validation";
import type { AIAnalysisResponse, AICandidateComparisonFacts } from "../types/ai-analysis";

async function testRetryControlFlow(): Promise<void> {
  let calls = 0;
  const firstPass = await runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => { calls += 1; return JSON.stringify({ valid: true }); },
    validate: (value) => value && typeof value === "object" && (value as { valid?: boolean }).valid === true
      ? { success: true as const, data: value }
      : { success: false as const, errors: ["invalid"] },
    createCorrectivePrompt: () => "corrective",
    shouldRetry: () => true,
  });
  assert.equal(firstPass.success, true);
  assert.equal(calls, 1, "A: first-pass success must call the model once");

  calls = 0;
  const corrected = await runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => JSON.stringify({ valid: ++calls === 2 }),
    validate: (value) => (value as { valid?: boolean }).valid === true
      ? { success: true as const, data: value }
      : { success: false as const, errors: ["comparison reversed"] },
    createCorrectivePrompt: (issues) => { assert.deepEqual(issues, ["comparison reversed"]); return "corrective"; },
    shouldRetry: () => true,
  });
  assert.equal(corrected.success, true);
  assert.equal(calls, 2, "B: corrective success must call the model twice");

  calls = 0;
  const rejected = await runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => { calls += 1; return JSON.stringify({ valid: false }); },
    validate: () => ({ success: false as const, errors: ["unsafe"] }),
    createCorrectivePrompt: () => "corrective",
    shouldRetry: () => true,
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.reason, "validation_failed");
  assert.equal(calls, 2, "C: two invalid responses must stop after two calls");

  calls = 0;
  await assert.rejects(() => runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => { calls += 1; throw new Error("provider unavailable"); },
    validate: () => ({ success: true as const, data: {} }),
    createCorrectivePrompt: () => "corrective",
    shouldRetry: () => true,
  }), /provider unavailable/);
  assert.equal(calls, 1, "D: provider failure must not trigger corrective retry");

  calls = 0;
  const hardFailure = await runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => { calls += 1; return JSON.stringify({ topPropertyId: "hallucinated" }); },
    validate: () => ({ success: false as const, errors: ["analysis.topPropertyId must equal deterministic Top1"] }),
    createCorrectivePrompt: () => "corrective",
    shouldRetry: shouldRetryAIAnalysisValidation,
  });
  assert.equal(hardFailure.success, false);
  assert.equal(calls, 1, "Hard authority/schema failures must not trigger corrective retry");
  assert.equal(shouldRetryAIAnalysisValidation(["analysis.decisionSummary reverses deterministic commute comparison"]), true);
}

const comparisons = {
  primaryAlternativeId: "property-b",
  primaryAlternativeName: "乙房",
  dimensions: [
    { dimensionKey: "commercial_amenities", label: "商业配套", relation: "EQUAL", top1Score: 100, top2Score: 100 },
  ],
  commute: {
    relation: "TOP1_WORSE_BUT_WITHIN_TARGET",
    top1PrimaryMinutes: 40,
    top1PartnerMinutes: null,
    top2PrimaryMinutes: 30,
    top2PartnerMinutes: null,
    primaryIdealMinutes: 35,
    primaryMaxMinutes: 60,
    partnerIdealMinutes: null,
    partnerMaxMinutes: null,
    top1TargetStatus: "WITHIN_MAX",
  },
  budgetMatch: {
    relation: "CLOSE",
    maximumBudget: 350,
    top1ExpectedTransactionPrice: 300,
    top2ExpectedTransactionPrice: 305,
    top1BudgetMargin: 50,
    top2BudgetMargin: 45,
  },
  buildingArea: {
    relation: "EQUAL",
    top1SquareMeters: 100,
    top2SquareMeters: 100,
  },
} satisfies AICandidateComparisonFacts;

function validateNarrative(summary: string, educationNeed: "none" | "current" = "current") {
  const response: AIAnalysisResponse = {
    ok: true,
    analysis: {
      topPropertyId: "property-a",
      topPropertyName: "甲房",
      decisionSummary: summary,
      pendingEvidence: ["核实物业服务"],
      disclaimer: "本解读基于当前信息。",
    },
    metadata: {
      generatedAt: "2026-08-28T00:00:00.000Z",
      inputSignature: "test-signature",
      provider: "zhipu",
      model: "test-model",
    },
  };
  const consistency: AINarrativeConsistencyConstraint = {
    educationNeed,
    comparisons,
    topPropertyName: "甲房",
    dimensions: [
      { key: "commercial_amenities", label: "商业配套", score: 100, status: "known" },
      { key: "education", label: "教育", score: null, status: "unknown" },
    ],
  };
  return validateAIAnalysisResponse(response, "property-a", "甲房", ["乙房"], false, consistency);
}

function testNarrativeSafety(): void {
  const equalInvalid = validateNarrative("相比乙房，甲房商业配套更强。乙房通勤更短，甲房仍在最大可接受范围。当前仍需确认物业服务。下一步核实物业服务。", "current");
  assert.equal(equalInvalid.success, false, "E: equal commercial evidence must reject a superiority claim");
  const equalCorrected = validateNarrative("相比乙房，双方商业配套相当。乙房通勤更短，甲房仍在最大可接受范围。当前仍需确认物业服务。下一步核实物业服务。", "current");
  assert.equal(equalCorrected.success, true, "E: corrected equal comparison must pass");

  const commuteInvalid = validateNarrative("相比乙房，甲房通勤更快，商业配套相当。当前仍需确认物业服务。下一步核实物业服务。", "current");
  assert.equal(commuteInvalid.success, false, "F: reversed commute direction must fail");
  const commuteCorrected = validateNarrative("相比乙房，乙房通勤更短；甲房本人约40分钟，高于理想值但仍在最大可接受范围，双方商业配套相当。当前仍需确认物业服务。下一步核实物业服务。", "current");
  assert.equal(commuteCorrected.success, true, "F: truthful commute correction must pass");

  const educationInvalid = validateNarrative("相比乙房，乙房通勤更短，双方商业配套相当。甲房教育资源更有优势。当前仍需确认物业服务。下一步核实物业服务。", "none");
  assert.equal(educationInvalid.success, false, "G: education must be omitted when educationNeed is none");
  const educationCorrected = validateNarrative("相比乙房，乙房通勤更短；甲房仍在最大可接受范围，双方商业配套相当。当前仍需确认物业服务。下一步核实物业服务。", "none");
  assert.equal(educationCorrected.success, true, "G: removing education comparison must pass");
}

async function main(): Promise<void> {
  await testRetryControlFlow();
  testNarrativeSafety();
  console.info("AI corrective retry scenarios A-G: PASS");
}

void main();
