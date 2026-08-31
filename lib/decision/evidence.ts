import type { BuyerPreferences } from "../../types/buyer-preferences";
import type { EvidenceItem } from "../../types/decision";
import type { Property } from "../../types/property";
import { validateTextField } from "./dataQuality";
import { NOISE_LABELS, QUALITY_LABELS } from "@/lib/decision-signals";

function item(
  id: string,
  title: string,
  category: EvidenceItem["category"],
  description: string,
  source: string,
): EvidenceItem {
  return { id, title, category, description, source };
}

export function buildEvidenceItems(
  property: Property,
  preferences: BuyerPreferences,
): EvidenceItem[] {
  const hasValidText = (value: string | null | undefined) => validateTextField(value).status === "valid";
  const evidence: EvidenceItem[] = [
    item("location", "房源位置", "confirmed", `${property.city} · ${property.district} · ${property.address}`, "用户输入"),
    item("area", "建筑面积", "confirmed", `${property.area}㎡`, "用户输入"),
    item("layout", "户型结构", "confirmed", property.layout, "用户输入"),
    item("price", "预期成交价", "confirmed", `${property.totalPrice} 万元`, "用户输入"),
    item("budget", "用户预算", "confirmed", `最高可接受总价 ${preferences.maximumBudget} 万元`, "购房偏好"),
  ];

  if (property.schoolInformation.trim()) {
    evidence.push(item("school", "学校信息", "confirmed", property.schoolInformation, "用户输入"));
  }
  if (property.propertyManagementInformation.trim()) {
    evidence.push(item("property-management", "物业信息", "confirmed", property.propertyManagementInformation, "用户输入"));
  }
  if (property.propertyFee !== null && property.propertyFee !== undefined && Number.isFinite(property.propertyFee) && property.propertyFee > 0) {
    evidence.push(item("property-fee", "物业费", "confirmed", `${property.propertyFee} 元/㎡/月`, "用户补充"));
  }
  if (property.greenRatio !== null && property.greenRatio !== undefined) evidence.push(item("green-ratio", "绿化率", "confirmed", `${property.greenRatio}%`, "用户录入的客观房源事实"));
  if (property.parkingRatio !== null && property.parkingRatio !== undefined) evidence.push(item("parking-ratio", "车位配比", "confirmed", `${property.parkingRatio} 车位/户`, "用户录入的客观房源事实"));
  const structuredObservations = [
    ["property-management-experience", "物业服务体验", property.propertyManagementExperience, QUALITY_LABELS],
    ["public-area-maintenance", "公共区域维护", property.publicAreaMaintenance, QUALITY_LABELS],
    ["community-environment-experience", "小区环境体验", property.communityEnvironmentExperience, QUALITY_LABELS],
    ["noise-experience", "噪音体验", property.noiseExperience, NOISE_LABELS],
    ["parking-experience", "停车体验", property.parkingExperience, QUALITY_LABELS],
    ["maintenance-condition", "整体维护状况", property.maintenanceCondition, QUALITY_LABELS],
  ] as const;
  for (const [id, title, value, labels] of structuredObservations) {
    if (value && value !== "unknown") evidence.push(item(id, title, "confirmed", labels[value as keyof typeof labels], "用户记录的主观观察"));
  }
  if (hasValidText(property.propertyExperience)) {
    evidence.push(item("property-experience", "物业服务体验", "confirmed", property.propertyExperience!, "用户现场观察"));
  }
  const communityObservations = [
    ["community-environment", "小区环境", property.environment],
    ["community-noise", "噪音情况", property.noise],
    ["community-parking", "停车情况", property.parking],
    ["community-public-area", "公共区域", property.publicArea],
  ] as const;
  for (const [id, title, value] of communityObservations) {
    if (hasValidText(value)) evidence.push(item(id, title, "confirmed", value!, "用户现场观察"));
  }
  if (hasValidText(property.actualCommuteExperience)) {
    evidence.push(item("actual-commute-experience", "实际通勤体验", "confirmed", property.actualCommuteExperience!, "用户实测记录"));
  }
  if (property.recentDealPrice !== null && property.recentDealPrice !== undefined && Number.isFinite(property.recentDealPrice) && property.recentDealPrice > 0) {
    evidence.push(item("recent-deal-lead", "历史成交价格线索", "optional_confirmation", `${property.recentDealPrice} 万元（旧数据待核验，不等同于已确认可比成交）`, "历史用户输入"));
  }
  const confirmedComparables = property.comparableTransactions?.filter((transaction) => transaction.confirmed) ?? [];
  const unconfirmedComparables = property.comparableTransactions?.filter((transaction) => !transaction.confirmed) ?? [];
  if (confirmedComparables.length > 0) {
    evidence.push(item("comparables-confirmed", "已确认成交参考", "confirmed", `已记录 ${confirmedComparables.length} 条用户标记为已确认的成交参考，仍由规则核验日期与完整性`, "用户输入"));
  }
  if (unconfirmedComparables.length > 0) {
    evidence.push(item("comparables-lead", "待核验成交参考", "optional_confirmation", `已记录 ${unconfirmedComparables.length} 条未确认成交线索，不参与成交价评分`, "用户输入"));
  }
  if (property.metroDistance !== null) {
    evidence.push(item("metro", "公共交通距离线索", "confirmed", `距最近地铁站约 ${property.metroDistance} 米`, "用户输入"));
  }
  if (property.deliveryYear) {
    evidence.push(item("delivery-year", "交付年份", "confirmed", `${property.deliveryYear} 年`, "用户输入"));
  }
  if (preferences.primaryWorkLocation.trim()) {
    evidence.push(item("work-location", "工作地点", "confirmed", preferences.primaryWorkLocation, "购房偏好"));
  }
  evidence.push(item(
    "education-need",
    "学校需求",
    "confirmed",
    preferences.educationNeed === "none" ? "暂无教育需求" : preferences.educationNeed === "current" ? "当前有教育需求" : "未来有教育需求",
    "购房偏好",
  ));

  evidence.push(
    item("ai-commercial", "商业配套", "ai_inferred", "结合两公里内大型商场、购物中心和商业综合体的距离与数量分析", "外部证据"),
    item("ai-medical", "医疗配套", "ai_inferred", "结合三公里内正规医院的距离与数量分析，不推断医院等级", "外部证据"),
    item("ai-community", "小区品质", "ai_inferred", "未来结合小区环境、维护状态与公共空间分析", "AI分析"),
    item("ai-liquidity", "流动性", "ai_inferred", "未来结合供需、户型受众与成交活跃度分析", "AI分析"),
    item("ai-value", "长期保值", "ai_inferred", "未来结合区域产业、交通和人口趋势分析", "AI分析"),
  );

  if (preferences.commuteMode !== "not_important" && !hasValidText(property.actualCommuteExperience)) {
    evidence.push(item("confirm-commute", "实际通勤体验", "optional_confirmation", "建议在工作日高峰实测，不影响当前判断", "用户确认"));
  }
  if (preferences.educationNeed !== "none") {
    evidence.push(item("confirm-enrollment", "入学与学位资格", "optional_confirmation", "建议向学校或主管部门核实，不影响当前判断", "用户确认"));
  }
  if (!hasValidText(property.propertyExperience)) {
    evidence.push(item("confirm-management", "物业费用与服务细节", "optional_confirmation", "可进一步核实收费标准和真实服务体验", "用户确认"));
  }
  if (![property.environment, property.noise, property.parking, property.publicArea].every(hasValidText)) {
    evidence.push(item("confirm-community", "小区现场品质", "optional_confirmation", "可进一步查看公区维护、噪音、停车和环境", "用户确认"));
  }
  evidence.push(item("confirm-layout", "户型实际利用率", "optional_confirmation", "可通过户型图或实地看房进一步确认", "用户确认"));
  if ((property.comparableTransactions?.length ?? 0) < 3) {
    evidence.push(item("confirm-comparables", "近期成交参考", "optional_confirmation", "增加可靠成交样本可提升价格判断可信度", "用户确认"));
  }

  return evidence;
}
