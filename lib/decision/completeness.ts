import type { BuyerPreferences } from "../../types/buyer-preferences";
import type { DataCompletenessResult } from "../../types/decision";
import type { Property } from "../../types/property";
import type { PropertyGeoEvidence } from "../../types/geo-evidence";
import { validateMetroDistance, validateTextField } from "./dataQuality";

interface WeightedField {
  label: string;
  weight: number;
  completed: boolean;
}

function hasValidText(value: string | null | undefined): boolean {
  return validateTextField(value).status === "valid";
}

function hasCompleteLayout(property: Property): boolean {
  if (!hasValidText(property.layout)) return false;
  if (property.layout === "其他" || property.layout.startsWith("5室及以上") || hasValidText(property.customLayout)) return true;
  return property.rooms > 0 && property.livingRooms > 0 && property.bathrooms > 0;
}

function calculateSection(fields: WeightedField[], sectionWeight: number): number {
  const applicableWeight = fields.reduce((sum, field) => sum + field.weight, 0);
  if (applicableWeight === 0) return sectionWeight;
  const completedWeight = fields.reduce((sum, field) => sum + (field.completed ? field.weight : 0), 0);
  return Math.round((completedWeight / applicableWeight) * sectionWeight);
}

export function calculateDataCompleteness(
  property: Property,
  preferences: BuyerPreferences,
  asOfDate: string,
  geoEvidence?: PropertyGeoEvidence,
): DataCompletenessResult {
  const basicFields: WeightedField[] = [
    { label: "房源名称", weight: 5, completed: hasValidText(property.name) },
    { label: "城市", weight: 5, completed: hasValidText(property.city) },
    { label: "行政区", weight: 5, completed: hasValidText(property.district) },
    { label: "详细地址", weight: 10, completed: hasValidText(property.address) },
    { label: "预期成交价", weight: 10, completed: Number.isFinite(property.totalPrice) && property.totalPrice > 0 },
    { label: "建筑面积", weight: 8, completed: Number.isFinite(property.area) && property.area > 0 },
    { label: "完整户型结构", weight: 8, completed: hasCompleteLayout(property) },
    { label: "楼层级别", weight: 4, completed: hasValidText(property.floorLevel) },
  ];

  const livingFields: WeightedField[] = [
    {
      label: "最近地铁距离",
      weight: 5,
      completed: validateMetroDistance(property.metroDistance).status === "valid" || (
        geoEvidence?.public_transport?.status !== "insufficient" &&
        geoEvidence?.public_transport?.quality !== "low" &&
        Number.isFinite(geoEvidence?.public_transport?.nearestDistanceMeters)
      ),
    },
    { label: "物业管理信息", weight: 5, completed: hasValidText(property.propertyManagementInformation) },
    { label: "交付年份", weight: 2, completed: property.deliveryYear !== null && property.deliveryYear !== undefined && Number.isInteger(property.deliveryYear) },
    { label: "朝向", weight: 1, completed: hasValidText(property.orientation) },
    { label: "实际楼层", weight: 2, completed: property.floorNumber !== null && property.floorNumber !== undefined && Number.isInteger(property.floorNumber) && property.floorNumber > 0 },
  ];
  if (preferences.educationNeed === "current") {
    livingFields.splice(1, 0, { label: "学校信息", weight: 5, completed: hasValidText(property.schoolInformation) });
  }

  const comparables = property.comparableTransactions ?? [];
  const asOfTime = Date.parse(`${asOfDate}T00:00:00Z`);
  const [asOfYear, asOfMonth, asOfDay] = asOfDate.split("-").map(Number);
  const cutoffTime = Date.UTC(asOfYear, asOfMonth - 1 - 24, asOfDay);
  const validComparableCount = comparables.filter((item) => {
    const transactionTime = Date.parse(`${item.transactionDate}T00:00:00Z`);
    return item.confirmed &&
      Number.isFinite(item.price) && item.price > 0 &&
      Number.isFinite(item.area) && item.area > 0 &&
      hasValidText(item.source) &&
      Number.isFinite(transactionTime) && Number.isFinite(asOfTime) &&
      transactionTime <= asOfTime && transactionTime >= cutoffTime;
  }).length;
  const comparableScore = validComparableCount >= 3
    ? 15
    : validComparableCount === 2
      ? 10
      : validComparableCount === 1
        ? 5
        : 0;
  const decisionFields: WeightedField[] = [
    { label: "挂牌价", weight: 5, completed: property.listingPrice !== null && property.listingPrice !== undefined && Number.isFinite(property.listingPrice) && property.listingPrice > 0 },
    { label: "近期有效成交参考（至少3条）", weight: 15, completed: validComparableCount >= 3 },
  ];

  const basic = calculateSection(basicFields, 60);
  const living = calculateSection(livingFields, 20);
  const listingScore = decisionFields[0].completed ? 5 : 0;
  const decision = listingScore + comparableScore;
  const completed = basic + living + decision;
  const allFields = [...basicFields, ...livingFields, ...decisionFields];

  return {
    percent: completed,
    completed,
    total: 100,
    missingFields: allFields.filter((field) => !field.completed).map((field) => field.label),
    sections: { basic, living, decision },
  };
}
