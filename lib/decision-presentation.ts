import { DIMENSION_LABELS } from "@/lib/decision/dimensions";
import type { BuyerPreferences, DecisionPriority } from "@/types/buyer-preferences";
import type { DimensionKey, PropertyDecisionResult } from "@/types/decision";
import type { GeoEvidenceByProperty, CommutePersonEvidence } from "@/types/geo-evidence";
import type { Property } from "@/types/property";
import type { WebEvidenceByProperty } from "@/lib/web-evidence/types";

export interface DecisionReasonPresentation { title: string; description: string }
export interface DecisionRiskPresentation { title: string; description: string }
export interface ComparisonPresentation {
  property: Property;
  result: PropertyDecisionResult;
  rank: number;
  primaryCommuteMinutes: number | null;
  partnerCommuteMinutes: number | null;
  keyAdvantage: string;
  keyRisk: string;
}

const PRIORITY_DIMENSIONS: Record<DecisionPriority, DimensionKey[]> = {
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

const PRIORITY_LABELS: Record<DecisionPriority, string> = {
  commute: "通勤便利",
  price: "价格与购买安全边际",
  layout_and_space: "户型与空间",
  community_quality: "小区品质",
  property_management: "物业服务",
  education: "教育",
  commercial_amenities: "商业生活配套",
  public_transport: "轨道交通",
  liquidity: "流动性",
  value_preservation: "长期保值",
};

function dimension(result: PropertyDecisionResult, key: DimensionKey) {
  return result.dimensions.find((item) => item.key === key);
}

function minutes(person: CommutePersonEvidence | undefined): number | null {
  return typeof person?.selectedMinutes === "number" && Number.isFinite(person.selectedMinutes) ? Math.round(person.selectedMinutes) : null;
}

function commuteText(propertyId: string, geo: GeoEvidenceByProperty): string | null {
  const commute = geo[propertyId]?.commute;
  const primary = minutes(commute?.primary);
  const partner = minutes(commute?.partner);
  if (primary === null && partner === null) return null;
  if (primary !== null && partner !== null) return `您的参考通勤约 ${primary} 分钟，伴侣约 ${partner} 分钟`;
  return primary !== null ? `您的参考通勤约 ${primary} 分钟` : `伴侣参考通勤约 ${partner} 分钟`;
}

function priorityReason(
  priority: DecisionPriority,
  property: Property,
  result: PropertyDecisionResult,
  alternative: Property | undefined,
  preferences: BuyerPreferences,
  geo: GeoEvidenceByProperty,
): DecisionReasonPresentation | null {
  if (priority === "price") {
    const margin = preferences.maximumBudget - property.totalPrice;
    const comparison = alternative ? property.totalPrice - alternative.totalPrice : 0;
    if (margin >= 0) return {
      title: "预算更从容",
      description: `预期成交价 ${property.totalPrice} 万元，比最高预算低约 ${Math.round(margin)} 万元${comparison < 0 ? `，也比主要备选低约 ${Math.abs(Math.round(comparison))} 万元` : ""}，为装修和后续支出保留余量。`,
    };
    return { title: "价格边界明确", description: `预期成交价比最高预算高约 ${Math.abs(Math.round(margin))} 万元，当前建议已将这一价格压力纳入判断。` };
  }
  if (priority === "commute") {
    const text = commuteText(property.id, geo);
    if (!text) return null;
    return { title: geo[property.id]?.commute?.partner ? "家庭通勤更均衡" : "通勤符合当前边界", description: `${text}，路线结果已用于当前通勤匹配判断；实际高峰仍可能波动。` };
  }
  if (priority === "layout_and_space") {
    const areaDifference = alternative ? property.area - alternative.area : 0;
    return {
      title: "空间更匹配",
      description: `${property.area}㎡ · ${property.layout}${areaDifference > 0 ? `，比主要备选多约 ${Math.round(areaDifference)}㎡` : ""}，为当前家庭居住需求提供更明确的空间基础。`,
    };
  }
  const relevant = PRIORITY_DIMENSIONS[priority]
    .map((key) => dimension(result, key))
    .find((item) => item?.score !== null && item?.evidence.length);
  const evidence = relevant?.evidence[0]?.description;
  return relevant && evidence ? { title: PRIORITY_LABELS[priority], description: evidence } : null;
}

export function buildWinningReasons(input: {
  property: Property;
  result: PropertyDecisionResult;
  alternative?: Property;
  preferences: BuyerPreferences;
  geoEvidenceByProperty: GeoEvidenceByProperty;
}): DecisionReasonPresentation[] {
  const ordered = [...input.preferences.topPriorities, "price", "commute", "layout_and_space"] as DecisionPriority[];
  const seen = new Set<string>();
  const reasons: DecisionReasonPresentation[] = [];
  for (const priority of ordered) {
    const reason = priorityReason(priority, input.property, input.result, input.alternative, input.preferences, input.geoEvidenceByProperty);
    if (!reason || seen.has(reason.title)) continue;
    seen.add(reason.title);
    reasons.push(reason);
    if (reasons.length === 3) break;
  }
  return reasons;
}

export function buildDecisionSummary(reasons: DecisionReasonPresentation[]): string {
  const labels = reasons.map((reason) => reason.title.replace(/更|当前/g, "")).slice(0, 3);
  return labels.length > 0
    ? `在${labels.join("、")}之间，目前整体取舍更均衡。`
    : "在当前已知信息下，这套房源与您的家庭需求整体更匹配。";
}

function webConclusion(web: WebEvidenceByProperty, propertyId: string, key: DimensionKey): string | null {
  const item = web[propertyId]?.dimensions.find((dimensionItem) => dimensionItem.dimensionKey === key);
  return item?.interpretation?.conclusion ?? item?.summary ?? null;
}

export function buildDecisionRisks(input: {
  property: Property;
  result: PropertyDecisionResult;
  preferences: BuyerPreferences;
  geoEvidenceByProperty: GeoEvidenceByProperty;
  webEvidenceByProperty: WebEvidenceByProperty;
}): DecisionRiskPresentation[] {
  const risks: DecisionRiskPresentation[] = [];
  const seen = new Set<string>();
  const add = (title: string, description: string) => {
    if (!seen.has(title) && risks.length < 4) { seen.add(title); risks.push({ title, description }); }
  };
  const transaction = dimension(input.result, "transaction_price_reasonableness");
  const management = dimension(input.result, "property_management");
  const community = dimension(input.result, "community_quality");
  const commute = input.geoEvidenceByProperty[input.property.id]?.commute;
  const education = dimension(input.result, "education");

  for (const priority of [...input.preferences.topPriorities, "property_management", "price", "community_quality", "commute", "education"] as DecisionPriority[]) {
    if (priority === "price" && transaction?.score === null) add("真实成交价", `近期同户型可比成交样本不足，${input.property.totalPrice} 万元仍属于预期成交假设。`);
    if (priority === "property_management" && management?.status !== "known") add("物业实际服务", webConclusion(input.webEvidenceByProperty, input.property.id, "property_management") ?? "目前缺少该小区真实服务记录，需要在购买前进一步确认。");
    if (priority === "community_quality" && community?.status !== "known") add("小区实际品质", webConclusion(input.webEvidenceByProperty, input.property.id, "community_quality") ?? "公开资料尚不足以替代现场看房和长期住户体验。");
    if (priority === "commute" && (!commute?.primary || commute.primary.status === "unavailable")) add("实际通勤体验", "当前缺少稳定路线证据，建议在常用时段实地确认门到门通勤体验。");
    if (priority === "education" && input.preferences.educationNeed !== "none" && education?.status !== "known") add("教育资格", "当前信息不能证明具体入学资格，仍需以最新官方政策和实际资格核验为准。");
  }
  for (const mismatch of input.result.hardMismatches) add(DIMENSION_LABELS[mismatch.dimension], mismatch.reason);
  for (const item of input.result.confidence.evidenceItems.filter((evidence) => evidence.category === "optional_confirmation")) add(item.title, item.description);
  return risks.slice(0, 4);
}

function strongestAdvantage(result: PropertyDecisionResult, priorities: DecisionPriority[]): string {
  const priorityKeys = priorities.flatMap((priority) => PRIORITY_DIMENSIONS[priority]);
  const priorityDimensions = result.dimensions.filter((item) => priorityKeys.includes(item.key) && item.score !== null);
  const best = [...(priorityDimensions.length > 0 ? priorityDimensions : result.dimensions)]
    .filter((item) => item.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0];
  return best ? `${DIMENSION_LABELS[best.key]}是当前较明确的优势` : "当前优势仍需更多证据确认";
}

function keyRisk(result: PropertyDecisionResult, priorities: DecisionPriority[]): string {
  if (result.hardMismatches[0]) return result.hardMismatches[0].reason;
  const priorityKeys = priorities.flatMap((priority) => PRIORITY_DIMENSIONS[priority]);
  const missing = result.dimensions.find((item) => priorityKeys.includes(item.key) && item.missingInputs.length > 0)
    ?? result.dimensions.find((item) => item.missingInputs.length > 0);
  return missing ? `${DIMENSION_LABELS[missing.key]}仍需确认` : "暂无明确硬性冲突";
}

export function buildQuickComparison(
  properties: Property[],
  results: PropertyDecisionResult[],
  geoEvidenceByProperty: GeoEvidenceByProperty,
  preferences?: BuyerPreferences,
): ComparisonPresentation[] {
  const byId = new Map(properties.map((property) => [property.id, property]));
  return results.flatMap((result, index) => {
    const property = byId.get(result.propertyId);
    if (!property) return [];
    const commute = geoEvidenceByProperty[property.id]?.commute;
    return [{
      property,
      result,
      rank: index + 1,
      primaryCommuteMinutes: minutes(commute?.primary),
      partnerCommuteMinutes: minutes(commute?.partner),
      keyAdvantage: strongestAdvantage(result, preferences?.topPriorities ?? []),
      keyRisk: keyRisk(result, preferences?.topPriorities ?? []),
    }];
  });
}
