import { DIMENSION_LABELS } from "@/lib/decision/dimensions";
import type { BuyerPreferences, DecisionPriority } from "@/types/buyer-preferences";
import type { DecisionReason, DimensionKey, PropertyDecisionResult } from "@/types/decision";
import type { GeoEvidenceByProperty, CommutePersonEvidence } from "@/types/geo-evidence";
import type { Property } from "@/types/property";
import type { WebEvidenceByProperty } from "@/lib/web-evidence/types";
import { validateTextField } from "@/lib/decision/dataQuality";

export interface DecisionRiskPresentation { title: string; description: string; suggestions: string[]; focusTarget: string }
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

function dimension(result: PropertyDecisionResult, key: DimensionKey) {
  return result.dimensions.find((item) => item.key === key);
}

function minutes(person: CommutePersonEvidence | undefined): number | null {
  return typeof person?.selectedMinutes === "number" && Number.isFinite(person.selectedMinutes) ? Math.round(person.selectedMinutes) : null;
}

export function buildDecisionSummary(reasons: ReadonlyArray<Pick<DecisionReason, "title">>): string {
  const labels = reasons.map((reason) => reason.title.replace(/更|当前/g, "")).slice(0, 3);
  if (labels.length === 1) return `目前最明确的优势是${labels[0]}。`;
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
  const add = (title: string, description: string, suggestions: string[], focusTarget = "supplemental-information") => {
    if (!seen.has(title) && risks.length < 4) { seen.add(title); risks.push({ title, description, suggestions, focusTarget }); }
  };
  const transaction = dimension(input.result, "transaction_price_reasonableness");
  const management = dimension(input.result, "property_management");
  const community = dimension(input.result, "community_quality");
  const commute = input.geoEvidenceByProperty[input.property.id]?.commute;
  const education = dimension(input.result, "education");
  const hasPropertyExperience = validateTextField(input.property.propertyExperience).status === "valid";
  const hasActualCommuteExperience = validateTextField(input.property.actualCommuteExperience).status === "valid";
  const communityChecks = [
    [input.property.environment, "查看绿化、卫生和采光"],
    [input.property.noise, "在不同时段确认噪音"],
    [input.property.parking, "核实车位和停车费用"],
    [input.property.publicArea, "查看大堂、电梯和走廊维护"],
  ] as const;
  const missingCommunityChecks = communityChecks.filter(([value]) => validateTextField(value).status !== "valid").map(([, suggestion]) => suggestion);

  for (const priority of [...input.preferences.topPriorities, "property_management", "price", "community_quality", "commute", "education"] as DecisionPriority[]) {
    if (priority === "price" && transaction?.score === null) add("真实成交价", input.property.recentDealPrice ? `已记录 ${input.property.recentDealPrice} 万元成交价格线索，但近期同户型可比成交样本仍不足，当前预期成交价尚需核验。` : `近期同户型可比成交样本不足，${input.property.totalPrice} 万元仍属于预期成交假设。`, ["向中介或业主索取同户型成交记录", "核对成交日期、面积和可靠来源"], "transaction-references");
    if (priority === "property_management" && management?.status !== "known" && !hasPropertyExperience) add("物业实际服务", webConclusion(input.webEvidenceByProperty, input.property.id, "property_management") ?? "目前只能确认管理主体，缺少该小区真实服务体验。", ["确认物业费和其他固定费用", "询问住户报修、门岗和保洁体验"], "property-service");
    if (priority === "community_quality" && community?.status !== "known" && missingCommunityChecks.length > 0) add("小区实际品质", webConclusion(input.webEvidenceByProperty, input.property.id, "community_quality") ?? "公开资料尚不足以替代现场看房和长期住户体验。", missingCommunityChecks.slice(0, 3), "community-quality");
    if (priority === "commute" && (!commute?.primary || commute.primary.status === "unavailable") && !hasActualCommuteExperience) add("实际通勤体验", "当前缺少稳定路线证据，建议在常用时段实地确认门到门通勤体验。", ["在工作日常用时段实测路线", "记录门到门耗时和换乘等待"], "actual-commute-experience");
    if (priority === "education" && input.preferences.educationNeed !== "none" && education?.status !== "known") add("教育资格", "当前信息不能证明具体入学资格，仍需以最新官方政策和实际资格核验为准。", ["核对当年招生范围", "向主管部门确认家庭资格条件"], "school-information");
  }
  for (const mismatch of input.result.hardMismatches) add(DIMENSION_LABELS[mismatch.dimension], mismatch.reason, ["核实当前输入与购买边界"]);
  for (const item of input.result.confidence.evidenceItems.filter((evidence) => evidence.category === "optional_confirmation")) add(item.title, item.description, [item.description]);
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
