import type { AIAnalysis, AINarrativeFact, AINarrativeFacts } from "../../types/ai-analysis";
import type { KnownDecisionContext, KnownDecisionFactor } from "../../types/known-decision-context";

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
  const allFacts = [...facts.requiredFacts, ...facts.comparisonFacts, ...facts.uncertaintyFacts];
  const topPriorityAnalysis = facts.userPriorities.map((priority) => {
    const related = allFacts.find((item) => item.dimension && (
      priority.dimension === "price" ? ["budget_match", "transaction_price_reasonableness"].includes(item.dimension)
        : priority.dimension === "layout_and_space" ? ["layout_design", "space_match"].includes(item.dimension)
          : item.dimension === priority.dimension
    ));
    return {
      priority: priority.dimension,
      analysis: related?.allowedMeaning ?? `目前仍缺少足够信息判断${priority.label}的候选差异，尚待确认。`,
    };
  });

  return {
    topPropertyId: facts.topCandidate.id,
    topPropertyName: facts.topCandidate.name,
    decisionSummary: [conclusion, comparison, uncertainty, `${actionSentence}${conditionalRecommendation}`].join("\n\n"),
    topPriorityAnalysis,
    tradeoff: comparison,
    additionalInsight: [],
    risksOrUnknowns: facts.uncertaintyFacts.map((item) => item.allowedMeaning).slice(0, 3),
    pendingEvidence: actions.slice(0, 3),
    disclaimer: DISCLAIMER,
  };
}

function fitReason(context: KnownDecisionContext, factor: KnownDecisionFactor): string | null {
  const top = context.candidates[0];
  if (!top) return null;
  if (factor.dimension === "budget_match" && top.propertyFacts.expectedTransactionPrice <= context.buyer.maximumBudget) {
    return `预期成交价${top.propertyFacts.expectedTransactionPrice}万元，控制在${context.buyer.maximumBudget}万元预算内`;
  }
  if (factor.dimension === "building_age" && top.propertyFacts.deliveryYear && factor.topScore >= 90) {
    return `${top.propertyFacts.deliveryYear}年交付，房龄相对较新`;
  }
  if (factor.dimension === "commute") {
    const commute = top.amapEvidence?.commute;
    const primary = commute?.primary?.selectedMinutes ?? commute?.durationMinutes;
    const partner = commute?.partner?.selectedMinutes;
    if (primary !== undefined && partner !== undefined) return `本人通勤约${primary}分钟、伴侣约${partner}分钟`;
    if (primary !== undefined) return `到工作地点通勤约${primary}分钟`;
  }
  if (factor.dimension === "commercial_amenities") {
    const commercial = top.amapEvidence?.commercial_amenities;
    if (commercial && commercial.countWithin2000m > 0) return `2公里内有${commercial.countWithin2000m}个商业体`;
  }
  if (factor.dimension === "medical_amenities") {
    const medical = top.amapEvidence?.medical_amenities;
    if (medical && medical.hospitalCountWithin3000m > 0) return `3公里内有${medical.hospitalCountWithin3000m}家正规医院`;
  }
  if (factor.dimension === "public_transport") {
    const transport = top.amapEvidence?.public_transport;
    if (transport?.nearestStationName && transport.nearestDistanceMeters !== undefined) return `最近地铁站约${Math.round(transport.nearestDistanceMeters)}米`;
  }
  if (["community_quality", "property_management"].includes(factor.dimension)) {
    const userReported = top.structuredSignals.some((signal) => signal.dimension === factor.dimension && signal.source === "user_reported" && (signal.normalizedValue ?? 0) >= 0.65);
    return userReported ? `你记录的${factor.label}体验较好` : null;
  }
  if (factor.dimension === "layout_design" && factor.topScore >= 80) return `${top.propertyFacts.layout}户型符合当前使用需要`;
  if (factor.dimension === "space_match" && factor.topScore >= 80) return `${top.propertyFacts.area}㎡空间与当前需求较匹配`;
  if (factor.topScore >= 80 && !["building_age", "transaction_price_reasonableness", "liquidity", "value_preservation"].includes(factor.dimension)) return `${factor.label}符合当前需求`;
  return null;
}

/** Current-context fallback for the final closed-world AI synthesis contract. */
export function createDeterministicKnownNarrative(context: KnownDecisionContext): AIAnalysis {
  const top = context.authoritativeTop1;
  const topCandidate = context.candidates[0];
  const reasons = context.decisiveKnownFactors
    .map((factor) => fitReason(context, factor))
    .filter((reason): reason is string => Boolean(reason))
    .filter((reason, index, items) => items.indexOf(reason) === index)
    .slice(0, 4);
  if (topCandidate && reasons.length < 2 && !reasons.some((reason) => /预算/.test(reason)) && topCandidate.propertyFacts.expectedTransactionPrice <= context.buyer.maximumBudget) {
    reasons.push(`预期成交价${topCandidate.propertyFacts.expectedTransactionPrice}万元，在${context.buyer.maximumBudget}万元预算内`);
  }
  if (topCandidate && reasons.length < 2) reasons.push(`建筑面积${topCandidate.propertyFacts.area}㎡`);
  const selectedReasons = reasons.slice(0, 4);
  const explanation = selectedReasons.length > 0
    ? `${selectedReasons.join("，")}，这些条件更贴合你现在的购房重点。`
    : "现有已知条件更贴合你现在的购房重点。";
  const decisionSummary = `${top.propertyName}目前更适合你。${explanation}因此更建议优先考虑。`;
  return {
    topPropertyId: top.propertyId,
    topPropertyName: top.propertyName,
    decisionSummary,
    pendingEvidence: [],
    disclaimer: DISCLAIMER,
  };
}
