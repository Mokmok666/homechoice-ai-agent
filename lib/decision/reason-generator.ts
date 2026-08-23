import { DIMENSION_LABELS } from "@/lib/decision/dimensions";
import type { BuyerPreferences, DecisionPriority } from "@/types/buyer-preferences";
import type {
  DecisionEngineResult,
  DecisionReason,
  DimensionEvaluation,
  DimensionKey,
  PropertyDecisionResult,
} from "@/types/decision";
import type { GeoEvidenceByProperty } from "@/types/geo-evidence";
import type { Property } from "@/types/property";

const PRIORITY_DIMENSIONS: Record<DecisionPriority, readonly DimensionKey[]> = {
  commute: ["commute"],
  price: ["budget_match", "transaction_price_reasonableness"],
  layout_and_space: ["layout_design", "space_match"],
  community_quality: ["community_quality"],
  property_management: ["property_management"],
  education: ["education"],
  commercial_amenities: ["commercial_amenities", "daily_life_amenities"],
  public_transport: ["public_transport"],
  liquidity: ["liquidity"],
  value_preservation: ["value_preservation"],
};

const REASON_TITLES: Partial<Record<DimensionKey, string>> = {
  commute: "家庭通勤更匹配",
  budget_match: "预算更从容",
  transaction_price_reasonableness: "成交价格依据更充分",
  layout_design: "户型更匹配",
  space_match: "空间更匹配",
  commercial_amenities: "商业生活更便利",
  daily_life_amenities: "日常生活更便利",
  public_transport: "公共交通更便利",
  community_quality: "小区品质证据更充分",
  property_management: "物业服务证据更充分",
  education: "教育需求更匹配",
  liquidity: "流动性证据更充分",
  value_preservation: "长期价值韧性更明确",
};

interface ReasonGeneratorInput {
  currentPreferences: BuyerPreferences;
  preferenceWeights: DecisionEngineResult["weights"];
  rankedProperties: Property[];
  rankedResults: PropertyDecisionResult[];
  geoEvidenceByProperty: GeoEvidenceByProperty;
}

interface EligibleDimension {
  evaluation: DimensionEvaluation;
  gap: number;
  confidence: DecisionReason["confidence"];
  importance: number;
  isPriority: boolean;
}

function findDimension(result: PropertyDecisionResult | undefined, key: DimensionKey): DimensionEvaluation | undefined {
  return result?.dimensions.find((item) => item.key === key);
}

function evidenceConfidence(dimension: DimensionEvaluation): DecisionReason["confidence"] {
  if (dimension.status === "known" && dimension.evidenceQuality >= 0.8) return "high";
  if (dimension.status !== "unknown" && dimension.evidenceQuality >= 0.55) return "medium";
  return "low";
}

function eligibleDimension(
  key: DimensionKey,
  topResult: PropertyDecisionResult,
  alternativeResult: PropertyDecisionResult | undefined,
  weight: number,
  priorityRank: number | null,
): EligibleDimension | null {
  const evaluation = findDimension(topResult, key);
  if (!evaluation || evaluation.score === null || evaluation.status === "unknown" || evaluation.evidence.length === 0) return null;
  const confidence = evidenceConfidence(evaluation);
  if (confidence === "low") return null;

  const alternativeEvaluation = findDimension(alternativeResult, key);
  const gap = alternativeEvaluation?.score === null || alternativeEvaluation?.score === undefined
    ? 0
    : evaluation.score - alternativeEvaluation.score;
  const isPriority = priorityRank !== null;
  const meaningfulDifference = gap >= 5;
  const strongAbsoluteFit = evaluation.score >= 70 && isPriority;
  if (alternativeResult && !meaningfulDifference && !strongAbsoluteFit) return null;
  if (!alternativeResult && evaluation.score < 60) return null;

  const reliability = confidence === "high" ? 1 : 0.75;
  const priorityBoost = priorityRank === 0 ? 1.35 : priorityRank === 1 ? 1.24 : priorityRank === 2 ? 1.14 : 1;
  const advantageSignal = meaningfulDifference ? gap : Math.max(1, (evaluation.score - 50) / 5);
  return {
    evaluation,
    gap,
    confidence,
    importance: weight * advantageSignal * reliability * priorityBoost,
    isPriority,
  };
}

function commuteDescription(propertyId: string, alternative: Property | undefined, geo: GeoEvidenceByProperty): string | null {
  const commute = geo[propertyId]?.commute;
  const primary = commute?.primary?.selectedMinutes;
  const partner = commute?.partner?.selectedMinutes;
  if (!Number.isFinite(primary) && !Number.isFinite(partner)) return null;
  const parts = [
    Number.isFinite(primary) ? `本人约${Math.round(primary as number)}分钟` : null,
    Number.isFinite(partner) ? `伴侣约${Math.round(partner as number)}分钟` : null,
  ].filter((item): item is string => item !== null);
  const alternativeCommute = alternative ? geo[alternative.id]?.commute : undefined;
  const alternativeParts = [
    Number.isFinite(alternativeCommute?.primary?.selectedMinutes) ? `本人约${Math.round(alternativeCommute!.primary!.selectedMinutes as number)}分钟` : null,
    Number.isFinite(alternativeCommute?.partner?.selectedMinutes) ? `伴侣约${Math.round(alternativeCommute!.partner!.selectedMinutes as number)}分钟` : null,
  ].filter((item): item is string => item !== null);
  return `${parts.join("，")}与家庭通勤目标更匹配${alternative && alternativeParts.length > 0 ? `；主要备选 ${alternative.name} 为${alternativeParts.join("、")}` : ""}。路线为地图参考，实际高峰体验仍需确认。`;
}

function reasonDescription(
  key: DimensionKey,
  property: Property,
  alternative: Property | undefined,
  preferences: BuyerPreferences,
  evaluation: DimensionEvaluation,
  geo: GeoEvidenceByProperty,
  isPriority: boolean,
  gap: number,
  confidence: DecisionReason["confidence"],
): string | null {
  const context = isPriority ? "这是您当前重点关注的因素。" : "虽然这不是您当前的前三项偏好，但它对候选差异有明显贡献。";
  const limitation = confidence === "high" ? "" : "当前证据仍有限，结论需结合后续核验。";
  if (key === "commute") {
    const detail = commuteDescription(property.id, alternative, geo);
    return detail ? `${context}${detail}${limitation}` : null;
  }
  if (key === "budget_match" || key === "transaction_price_reasonableness") {
    const budgetMargin = Math.round(preferences.maximumBudget - property.totalPrice);
    const alternativeGap = alternative ? Math.round(alternative.totalPrice - property.totalPrice) : 0;
    if (budgetMargin >= 0) {
      return `${context}预期成交价 ${property.totalPrice} 万元，比最高预算低约 ${budgetMargin} 万元${alternativeGap > 0 ? `，也比主要备选低约 ${alternativeGap} 万元` : ""}，为装修和后续支出保留更多余量。${limitation}`;
    }
    return `${context}预期成交价高于最高预算约 ${Math.abs(budgetMargin)} 万元；该维度虽有候选差异，但仍需优先核实价格边界。${limitation}`;
  }
  if (key === "layout_design" || key === "space_match") {
    const areaGap = alternative ? Math.round(property.area - alternative.area) : 0;
    return `${context}${property.area}㎡ · ${property.layout}${areaGap > 0 ? `，比主要备选多约 ${areaGap}㎡` : ""}，在当前候选中更贴近家庭的户型与空间偏好。${limitation}`;
  }
  const evidence = evaluation.evidence[0]?.description;
  if (!evidence) return null;
  const evidenceSentence = /[。！？]$/.test(evidence) ? evidence : `${evidence}。`;
  const comparison = alternative && gap >= 5
    ? `相比主要备选 ${alternative.name}，该维度的可计算结果高约 ${Math.round(gap)} 分。`
    : "";
  return `${context}${evidenceSentence}${comparison}${limitation}`;
}

function buildReason(
  candidate: EligibleDimension,
  property: Property,
  alternative: Property | undefined,
  preferences: BuyerPreferences,
  geo: GeoEvidenceByProperty,
): DecisionReason | null {
  const description = reasonDescription(candidate.evaluation.key, property, alternative, preferences, candidate.evaluation, geo, candidate.isPriority, candidate.gap, candidate.confidence);
  if (!description) return null;
  const title = candidate.evaluation.key === "budget_match" && property.totalPrice > preferences.maximumBudget
    ? "预算压力相对较低"
    : REASON_TITLES[candidate.evaluation.key] ?? `${DIMENSION_LABELS[candidate.evaluation.key]}更具优势`;
  return {
    title,
    description,
    dimension: candidate.evaluation.key,
    confidence: candidate.confidence,
    label: candidate.isPriority
      ? "您的重点偏好"
      : candidate.gap >= 5
        ? "关键差异"
        : candidate.confidence === "high"
          ? "强证据支持"
          : undefined,
  };
}

/** Generates current-page reasons from the authoritative ranking and current preferences only. */
export function generateDecisionReasons(input: ReasonGeneratorInput): DecisionReason[] {
  const topResult = input.rankedResults[0];
  const alternativeResult = input.rankedResults[1];
  if (!topResult) return [];
  const propertyById = new Map(input.rankedProperties.map((property) => [property.id, property]));
  const property = propertyById.get(topResult.propertyId);
  const alternative = alternativeResult ? propertyById.get(alternativeResult.propertyId) : undefined;
  if (!property) return [];

  const priorityRankByDimension = new Map<DimensionKey, number>();
  input.currentPreferences.topPriorities.slice(0, 3).forEach((priority, index) => {
    PRIORITY_DIMENSIONS[priority].forEach((key) => {
      if (!priorityRankByDimension.has(key)) priorityRankByDimension.set(key, index);
    });
  });
  const candidates = topResult.dimensions
    .map((item) => eligibleDimension(
      item.key,
      topResult,
      alternativeResult,
      input.preferenceWeights[item.key],
      priorityRankByDimension.get(item.key) ?? null,
    ))
    .filter((item): item is EligibleDimension => item !== null)
    .sort((left, right) => right.importance - left.importance || right.gap - left.gap || left.evaluation.key.localeCompare(right.evaluation.key));

  return candidates
    .flatMap((candidate) => {
      const reason = buildReason(candidate, property, alternative, input.currentPreferences, input.geoEvidenceByProperty);
      return reason ? [reason] : [];
    })
    .slice(0, 3);
}
