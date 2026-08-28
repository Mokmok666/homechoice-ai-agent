import type { AIAnalysis, AINarrativeFact, AINarrativeFacts } from "../../types/ai-analysis";

const DISCLAIMER = "本解读基于当前已知信息与房源比较结果，不替代实地核验和专业意见。";

function sentences(facts: Array<Pick<AINarrativeFact, "allowedMeaning">>): string {
  return facts
    .map((fact) => fact.allowedMeaning.trim())
    .filter(Boolean)
    .map((text) => /[。！？]$/.test(text) ? text : `${text}。`)
    .join("");
}

/** Converts already-selected authoritative facts into the existing user-facing schema. */
export function createDeterministicNarrative(facts: AINarrativeFacts): AIAnalysis {
  const conclusionFacts = sentences(facts.requiredFacts);
  const conclusion = `${facts.topCandidate.name}是当前更适合优先继续核验的房源。${conclusionFacts}`;

  const primaryAlternative = facts.candidateOrder[1];
  const comparisonDetails = facts.comparisonFacts.length > 0
    ? sentences(facts.comparisonFacts)
    : primaryAlternative
      ? "当前仍存在若干待确认差异，现有信息不足以进一步拉开判断。"
      : "当前只有一套候选房源，因此没有其他候选可供比较。";
  const comparison = primaryAlternative && !comparisonDetails.includes(primaryAlternative.name)
    ? `与${primaryAlternative.name}相比，${comparisonDetails}`
    : comparisonDetails;

  const uncertainty = facts.uncertaintyFacts.length > 0
    ? sentences(facts.uncertaintyFacts)
    : "当前没有额外列出的待确认事项。";

  const actions = facts.nextStepFacts.map((fact) => fact.allowedMeaning.trim()).filter(Boolean);
  const actionSentence = actions.length > 0
    ? `下一步建议${actions.join("、")}。`
    : "下一步建议在购买前复核当前房源信息。";
  const conditionalRecommendation = "如果这些关键验证结果明显低于当前预期，应重新比较现有候选。";

  return {
    topPropertyId: facts.topCandidate.id,
    topPropertyName: facts.topCandidate.name,
    decisionSummary: [conclusion, comparison, uncertainty, `${actionSentence}${conditionalRecommendation}`].join("\n\n"),
    pendingEvidence: actions.slice(0, 3),
    disclaimer: DISCLAIMER,
  };
}
