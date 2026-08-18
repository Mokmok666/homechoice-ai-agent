import type { BuyerPreferences } from "../../types/buyer-preferences";
import type { EvidenceItem } from "../../types/decision";
import type { Property } from "../../types/property";

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
  if ((property.comparableTransactions?.length ?? 0) > 0) {
    evidence.push(item("comparables", "成交参考", "confirmed", `已记录 ${property.comparableTransactions!.length} 条成交参考`, "用户输入"));
  }
  if (property.metroDistance !== null) {
    evidence.push(item("metro", "轨道交通距离", "confirmed", `距最近地铁站约 ${property.metroDistance} 米`, "用户输入"));
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
    item("ai-commercial", "商业成熟度", "ai_inferred", "未来结合周边商业层级、距离与日常可达性分析", "AI分析"),
    item("ai-daily-life", "日常生活便利", "ai_inferred", "未来结合生活服务设施与使用场景分析", "AI分析"),
    item("ai-community", "小区品质", "ai_inferred", "未来结合小区环境、维护状态与公共空间分析", "AI分析"),
    item("ai-liquidity", "流动性", "ai_inferred", "未来结合供需、户型受众与成交活跃度分析", "AI分析"),
    item("ai-value", "长期保值", "ai_inferred", "未来结合区域产业、交通和人口趋势分析", "AI分析"),
  );

  if (preferences.commuteMode !== "not_important") {
    evidence.push(item("confirm-commute", "实际通勤体验", "optional_confirmation", "建议在工作日高峰实测，不影响当前判断", "用户确认"));
  }
  if (preferences.educationNeed !== "none") {
    evidence.push(item("confirm-enrollment", "入学与学位资格", "optional_confirmation", "建议向学校或主管部门核实，不影响当前判断", "用户确认"));
  }
  evidence.push(
    item("confirm-management", "物业费用与服务细节", "optional_confirmation", "可进一步核实收费标准和真实服务体验", "用户确认"),
    item("confirm-layout", "户型实际利用率", "optional_confirmation", "可通过户型图或实地看房进一步确认", "用户确认"),
  );
  if ((property.comparableTransactions?.length ?? 0) < 3) {
    evidence.push(item("confirm-comparables", "近期成交参考", "optional_confirmation", "增加可靠成交样本可提升价格判断可信度", "用户确认"));
  }

  return evidence;
}
