import { DIMENSION_LABELS } from "@/lib/decision/dimensions";
import { FAMILY_COMMUTE_WEIGHTS } from "@/lib/commute-evidence";
import {
  resolvePartnerCommutePreference,
  resolvePrimaryCommutePreference,
} from "@/types/buyer-preferences";
import type { BuyerPreferences, DecisionPriority } from "@/types/buyer-preferences";
import type {
  DecisionEngineResult,
  DecisionReason,
  DecisionReasonType,
  DimensionEvaluation,
  DimensionKey,
  PropertyDecisionResult,
} from "@/types/decision";
import type { CommutePersonEvidence, GeoEvidenceByProperty } from "@/types/geo-evidence";
import type { Property } from "@/types/property";

const PRIORITY_DIMENSIONS: Record<DecisionPriority, readonly DimensionKey[]> = {
  commute: ["commute"],
  price: ["budget_match", "transaction_price_reasonableness"],
  layout_and_space: ["layout_design", "space_match"],
  community_quality: ["community_quality"],
  property_management: ["property_management"],
  education: ["education"],
  commercial_amenities: ["commercial_amenities"],
  medical_amenities: ["medical_amenities"],
  public_transport: ["public_transport"],
  liquidity: ["liquidity"],
  value_preservation: ["value_preservation"],
};

const DIFFERENTIATOR_TITLES: Partial<Record<DimensionKey, string>> = {
  commute: "家庭通勤更省时",
  budget_match: "预算更从容",
  transaction_price_reasonableness: "成交价格依据更充分",
  layout_design: "户型适配度更高",
  space_match: "空间更充裕",
  commercial_amenities: "大型商业相对更便利",
  medical_amenities: "正规医疗相对更便利",
  public_transport: "公共交通相对更便利",
  community_quality: "小区品质证据相对更充分",
  property_management: "物业服务证据相对更充分",
  education: "教育需求适配度更高",
  liquidity: "流动性证据相对更充分",
  value_preservation: "长期价值证据相对更充分",
  building_age: "楼龄表现相对更好",
  location_maturity: "地段成熟度相对更高",
};

const NEUTRAL_TITLES: Partial<Record<DimensionKey, string>> = {
  commute: "家庭通勤满足目标",
  budget_match: "预算处于可承受范围",
  transaction_price_reasonableness: "成交价格依据形成支撑",
  layout_design: "户型满足当前需求",
  space_match: "空间满足当前需求",
  commercial_amenities: "大型商业配套成熟",
  medical_amenities: "正规医疗可达性良好",
  public_transport: "公共交通形成支撑",
  community_quality: "小区品质信息形成支撑",
  property_management: "物业服务信息形成支撑",
  education: "教育需求得到支持",
  liquidity: "流动性信息形成支撑",
  value_preservation: "长期价值信息形成支撑",
  building_age: "楼龄表现良好",
  location_maturity: "地段成熟度形成支撑",
};

const EVIDENCE_GAP_PATTERN = /(?:缺少|不足|未知|无法判断|尚无法|待确认|未提供|未填写|暂无|无有效|证据缺口)/;

interface ReasonGeneratorInput {
  currentPreferences: BuyerPreferences;
  preferenceWeights: DecisionEngineResult["weights"];
  rankedProperties: Property[];
  rankedResults: PropertyDecisionResult[];
  geoEvidenceByProperty: GeoEvidenceByProperty;
}

interface ReasonCandidate {
  evaluation: DimensionEvaluation;
  type: DecisionReasonType;
  confidence: DecisionReason["confidence"];
  gap: number;
  strength: number;
  semanticGroup: string;
}

function findDimension(result: PropertyDecisionResult | undefined, key: DimensionKey): DimensionEvaluation | undefined {
  return result?.dimensions.find((item) => item.key === key);
}

function evidenceConfidence(dimension: DimensionEvaluation): DecisionReason["confidence"] {
  if (dimension.status === "known" && dimension.evidenceQuality >= 0.8) return "high";
  if (dimension.evidenceQuality >= 0.55) return "medium";
  return "low";
}

function hasUsableEvidence(dimension: DimensionEvaluation): boolean {
  return dimension.evidence.some((item) => {
    const description = item.description.trim();
    return description.length > 0 && !EVIDENCE_GAP_PATTERN.test(description);
  });
}

function semanticGroup(key: DimensionKey): string {
  if (key === "budget_match" || key === "transaction_price_reasonableness") return "price";
  if (key === "layout_design" || key === "space_match") return "layout-space";
  return key;
}

function priorityRankMap(preferences: BuyerPreferences): Map<DimensionKey, number> {
  const result = new Map<DimensionKey, number>();
  preferences.topPriorities.slice(0, 3).forEach((priority, index) => {
    PRIORITY_DIMENSIONS[priority].forEach((key) => {
      if (!result.has(key)) result.set(key, index);
    });
  });
  return result;
}

function selectedMinutes(person: CommutePersonEvidence | undefined): number | null {
  return Number.isFinite(person?.selectedMinutes) ? person!.selectedMinutes! : null;
}

function familyCommuteMinutes(propertyId: string, geo: GeoEvidenceByProperty): number | null {
  const commute = geo[propertyId]?.commute;
  const primary = selectedMinutes(commute?.primary);
  const partner = selectedMinutes(commute?.partner);
  if (primary !== null && partner !== null) {
    return primary * FAMILY_COMMUTE_WEIGHTS.primary + partner * FAMILY_COMMUTE_WEIGHTS.partner;
  }
  return primary ?? partner;
}

function isTrueDifferentiator(
  key: DimensionKey,
  evaluation: DimensionEvaluation,
  alternativeEvaluation: DimensionEvaluation | undefined,
  property: Property,
  alternative: Property | undefined,
  geo: GeoEvidenceByProperty,
): boolean {
  if (evaluation.score === null || !alternative || !alternativeEvaluation || alternativeEvaluation.score === null) return false;
  if (key === "budget_match") {
    return property.totalPrice < alternative.totalPrice && evaluation.score >= alternativeEvaluation.score;
  }
  if (key === "space_match") {
    return property.area > alternative.area && evaluation.score >= alternativeEvaluation.score;
  }
  if (key === "commute") {
    const current = familyCommuteMinutes(property.id, geo);
    const other = familyCommuteMinutes(alternative.id, geo);
    return current !== null && other !== null && current < other && evaluation.score > alternativeEvaluation.score;
  }
  return evaluation.score - alternativeEvaluation.score >= 5;
}

function withinThreshold(value: number | null, threshold: number | null): boolean {
  return value !== null && threshold !== null && value <= threshold;
}

function meetsPreferenceTarget(
  key: DimensionKey,
  evaluation: DimensionEvaluation,
  property: Property,
  preferences: BuyerPreferences,
  geo: GeoEvidenceByProperty,
): boolean {
  if (evaluation.score === null) return false;
  if (key === "budget_match") return property.totalPrice <= preferences.maximumBudget;
  if (key === "commute") {
    const commute = geo[property.id]?.commute;
    const primaryPreference = resolvePrimaryCommutePreference(preferences);
    const partnerPreference = resolvePartnerCommutePreference(preferences);
    const primary = selectedMinutes(commute?.primary);
    const partner = selectedMinutes(commute?.partner);
    if (primary === null || primaryPreference.maxMinutes === null || primary > primaryPreference.maxMinutes) return false;
    if (partnerPreference && (partner === null || partnerPreference.maxMinutes === null || partner > partnerPreference.maxMinutes)) return false;
    return true;
  }
  return evaluation.score >= 70;
}

function createCandidate(
  evaluation: DimensionEvaluation,
  alternativeResult: PropertyDecisionResult | undefined,
  property: Property,
  alternative: Property | undefined,
  preferences: BuyerPreferences,
  geo: GeoEvidenceByProperty,
  priorityRank: number | null,
  maxFinalWeight: number,
): ReasonCandidate | null {
  if (evaluation.score === null || evaluation.status === "unknown" || !hasUsableEvidence(evaluation)) return null;
  if (evaluation.key === "education" && preferences.educationNeed === "none") return null;
  // A low score may be an important risk, but it is not a positive purchase reason.
  if (evaluation.score < 60) return null;

  const alternativeEvaluation = findDimension(alternativeResult, evaluation.key);
  const gap = alternativeEvaluation?.score === null || alternativeEvaluation?.score === undefined
    ? 0
    : evaluation.score - alternativeEvaluation.score;
  const differentiator = isTrueDifferentiator(
    evaluation.key,
    evaluation,
    alternativeEvaluation,
    property,
    alternative,
    geo,
  );
  const preferenceMatch = priorityRank !== null && meetsPreferenceTarget(
    evaluation.key,
    evaluation,
    property,
    preferences,
    geo,
  );
  const type: DecisionReasonType = differentiator
    ? "DIFFERENTIATOR"
    : preferenceMatch
      ? "PREFERENCE_MATCH"
      : "SUPPORTING_FACTOR";
  const confidence = evidenceConfidence(evaluation);
  const reliability = confidence === "high" ? 1 : confidence === "medium" ? 0.8 : 0.6;
  const normalizedWeight = maxFinalWeight > 0 ? evaluation.finalWeight / maxFinalWeight : 0;
  const basePerformance = evaluation.score / 100;
  const differenceFactor = differentiator ? 1 + Math.min(Math.max(gap, 5) / 100, 0.35) : type === "SUPPORTING_FACTOR" ? 0.9 : 1;
  const preferenceBoost = priorityRank === 0 ? 1.25 : priorityRank === 1 ? 1.18 : priorityRank === 2 ? 1.1 : 1;

  return {
    evaluation,
    type,
    confidence,
    gap,
    strength: normalizedWeight * reliability * basePerformance * differenceFactor * preferenceBoost,
    semanticGroup: semanticGroup(evaluation.key),
  };
}

function formatMinutes(value: number | null): string | null {
  return value === null ? null : `约${Math.round(value)}分钟`;
}

function commuteDescription(
  type: DecisionReasonType,
  property: Property,
  alternative: Property | undefined,
  preferences: BuyerPreferences,
  geo: GeoEvidenceByProperty,
): string | null {
  const commute = geo[property.id]?.commute;
  const primary = selectedMinutes(commute?.primary);
  const partner = selectedMinutes(commute?.partner);
  if (primary === null && partner === null) return null;
  const primaryPreference = resolvePrimaryCommutePreference(preferences);
  const partnerPreference = resolvePartnerCommutePreference(preferences);
  const parts = [
    primary !== null ? `本人${formatMinutes(primary)}` : null,
    partner !== null ? `伴侣${formatMinutes(partner)}` : null,
  ].filter((item): item is string => item !== null);
  const allIdeal = (primary === null || withinThreshold(primary, primaryPreference.idealMinutes))
    && (!partnerPreference || partner === null || withinThreshold(partner, partnerPreference.idealMinutes));
  const target = allIdeal
    ? parts.length > 1 ? "均处于各自设定的理想范围内" : "处于设定的理想范围内"
    : parts.length > 1 ? "均保持在各自设定的最长可接受范围内" : "保持在设定的最长可接受范围内";

  const alternativeCommute = alternative ? geo[alternative.id]?.commute : undefined;
  const alternativePrimary = selectedMinutes(alternativeCommute?.primary);
  const alternativePartner = selectedMinutes(alternativeCommute?.partner);
  const comparablePairs = [
    primary !== null && alternativePrimary !== null ? [primary, alternativePrimary] as const : null,
    partner !== null && alternativePartner !== null ? [partner, alternativePartner] as const : null,
  ].filter((pair): pair is readonly [number, number] => pair !== null);
  const alternativeStrictlyShorter = comparablePairs.length > 0
    && comparablePairs.every(([current, other]) => other <= current)
    && comparablePairs.some(([current, other]) => other < current);
  const close = comparablePairs.length > 0
    && comparablePairs.every(([current, other]) => Math.abs(current - other) <= 5);

  if (type === "DIFFERENTIATOR" && alternative && comparablePairs.length > 0) {
    return `${parts.join("、")}，${target}；相比主要备选 ${alternative.name}，当前家庭路线的综合耗时更短。路线为地图参考，实际高峰体验仍需确认。`;
  }
  if (alternative && alternativeStrictlyShorter) {
    return `${parts.join("、")}，${target}。虽然 ${alternative.name} 的通勤时间更短，但 ${property.name} 仍满足当前家庭的通勤目标，因此不会成为明显短板。`;
  }
  if (alternative && close) {
    return `${parts.join("、")}，${target}；与主要备选 ${alternative.name} 的通勤表现接近、差异有限，当前仍满足家庭通勤目标。`;
  }
  return `${parts.join("、")}，${target}，当前通勤不会构成明显短板。路线为地图参考，实际高峰体验仍需确认。`;
}

function budgetDescription(
  type: DecisionReasonType,
  property: Property,
  alternative: Property | undefined,
  preferences: BuyerPreferences,
): string {
  const budgetMargin = Math.round(preferences.maximumBudget - property.totalPrice);
  const alternativeGap = alternative ? Math.round(alternative.totalPrice - property.totalPrice) : 0;
  if (type === "DIFFERENTIATOR" && alternativeGap > 0) {
    return `预期成交价 ${property.totalPrice} 万元，比家庭最高预算低约 ${Math.max(0, budgetMargin)} 万元，也比主要备选 ${alternative!.name} 低约 ${alternativeGap} 万元，为装修和后续家庭支出保留更多资金余量。`;
  }
  if (budgetMargin >= 0) {
    return `预期成交价 ${property.totalPrice} 万元，位于家庭最高预算范围内，并保留约 ${budgetMargin} 万元资金余量；这仅说明预算匹配，不代表成交价格已经得到市场验证。`;
  }
  return `预期成交价高于最高预算约 ${Math.abs(budgetMargin)} 万元，当前预算证据不适合作为正向购买理由。`;
}

function spaceDescription(
  type: DecisionReasonType,
  property: Property,
  alternative: Property | undefined,
): string {
  const areaGap = alternative ? Math.round(property.area - alternative.area) : 0;
  if (type === "DIFFERENTIATOR" && alternative && areaGap > 0) {
    return `${property.area}㎡比主要备选 ${alternative.name} 的 ${alternative.area}㎡多约 ${areaGap}㎡，在当前家庭居住需求下提供更多空间余量；该结论不等同于户型利用率更高。`;
  }
  return `${property.area}㎡ · ${property.layout} 的空间表现已达到当前可计算需求，能够为整体居住匹配提供支撑；户型实际利用率仍以实地查看为准。`;
}

function evidenceDescription(candidate: ReasonCandidate, alternative: Property | undefined): string | null {
  const evidence = candidate.evaluation.evidence.find((item) => !EVIDENCE_GAP_PATTERN.test(item.description))?.description.trim();
  if (!evidence) return null;
  const evidenceSentence = /[。！？]$/.test(evidence) ? evidence : `${evidence}。`;
  if (candidate.type === "DIFFERENTIATOR" && alternative) {
    return `${evidenceSentence}相比主要备选 ${alternative.name}，该维度的合法可计算结果相对更强。`;
  }
  return `${evidenceSentence}该项已有有效证据并处于正常或良好水平，为当前综合判断提供支撑。`;
}

function buildReason(
  candidate: ReasonCandidate,
  property: Property,
  alternative: Property | undefined,
  preferences: BuyerPreferences,
  geo: GeoEvidenceByProperty,
): DecisionReason | null {
  const key = candidate.evaluation.key;
  let description: string | null;
  if (key === "commute") {
    description = commuteDescription(candidate.type, property, alternative, preferences, geo);
  } else if (key === "budget_match") {
    description = budgetDescription(candidate.type, property, alternative, preferences);
  } else if (key === "layout_design" || key === "space_match") {
    description = spaceDescription(candidate.type, property, alternative);
  } else {
    description = evidenceDescription(candidate, alternative);
  }
  if (!description) return null;

  return {
    title: candidate.type === "DIFFERENTIATOR"
      ? DIFFERENTIATOR_TITLES[key] ?? `${DIMENSION_LABELS[key]}相对更强`
      : NEUTRAL_TITLES[key] ?? `${DIMENSION_LABELS[key]}形成支撑`,
    description,
    dimension: key,
    confidence: candidate.confidence,
    type: candidate.type,
    label: candidate.type === "DIFFERENTIATOR"
      ? "关键优势"
      : candidate.type === "PREFERENCE_MATCH"
        ? "您的重点偏好"
        : "综合支撑",
  };
}

function typeOrder(type: DecisionReasonType): number {
  return type === "DIFFERENTIATOR" ? 0 : type === "PREFERENCE_MATCH" ? 1 : 2;
}

/** Generates deterministic current-page reasons from authoritative results; it never changes scoring or ranking. */
export function generateDecisionReasons(input: ReasonGeneratorInput): DecisionReason[] {
  const topResult = input.rankedResults[0];
  const alternativeResult = input.rankedResults[1];
  if (!topResult) return [];
  const propertyById = new Map(input.rankedProperties.map((property) => [property.id, property]));
  const property = propertyById.get(topResult.propertyId);
  const alternative = alternativeResult ? propertyById.get(alternativeResult.propertyId) : undefined;
  if (!property) return [];

  const priorities = priorityRankMap(input.currentPreferences);
  const maxFinalWeight = Math.max(0, ...topResult.dimensions.map((item) => item.finalWeight));
  const candidates = topResult.dimensions
    .map((evaluation) => createCandidate(
      evaluation,
      alternativeResult,
      property,
      alternative,
      input.currentPreferences,
      input.geoEvidenceByProperty,
      priorities.get(evaluation.key) ?? null,
      maxFinalWeight,
    ))
    .filter((candidate): candidate is ReasonCandidate => candidate !== null)
    .sort((left, right) =>
      typeOrder(left.type) - typeOrder(right.type)
      || right.strength - left.strength
      || right.gap - left.gap
      || left.evaluation.key.localeCompare(right.evaluation.key));

  const selected: DecisionReason[] = [];
  const usedDimensions = new Set<DimensionKey>();
  const usedSemanticGroups = new Set<string>();
  for (const candidate of candidates) {
    if (selected.length === 3) break;
    if (usedDimensions.has(candidate.evaluation.key) || usedSemanticGroups.has(candidate.semanticGroup)) continue;
    const reason = buildReason(candidate, property, alternative, input.currentPreferences, input.geoEvidenceByProperty);
    if (!reason) continue;
    selected.push(reason);
    usedDimensions.add(candidate.evaluation.key);
    usedSemanticGroups.add(candidate.semanticGroup);
  }

  // Defensive fallback only: fewer than 3 legitimate known dimensions exist.
  return selected;
}
