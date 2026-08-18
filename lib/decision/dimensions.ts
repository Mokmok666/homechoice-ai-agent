import type { DimensionKey, DimensionType } from "../../types/decision";

export const BASE_WEIGHTS: Record<DimensionKey, number> = {
  location_maturity: 6,
  commute: 10,
  public_transport: 6,
  commercial_amenities: 5,
  education: 6,
  daily_life_amenities: 3,
  layout_design: 8,
  space_match: 8,
  building_age: 5,
  community_quality: 7,
  property_management: 5,
  budget_match: 10,
  transaction_price_reasonableness: 8,
  liquidity: 6,
  value_preservation: 7,
};

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  location_maturity: "地段成熟度",
  commute: "通勤匹配",
  public_transport: "轨道交通",
  commercial_amenities: "商业配套",
  education: "教育需求",
  daily_life_amenities: "日常生活便利",
  layout_design: "户型设计",
  space_match: "空间匹配",
  building_age: "楼龄",
  community_quality: "小区品质",
  property_management: "物业服务",
  budget_match: "预算匹配",
  transaction_price_reasonableness: "成交价合理性",
  liquidity: "流动性",
  value_preservation: "长期保值",
};

export const DIMENSION_TYPES: Record<DimensionKey, DimensionType> = {
  location_maturity: "fact",
  commute: "preference",
  public_transport: "fact",
  commercial_amenities: "ai",
  education: "preference",
  daily_life_amenities: "ai",
  layout_design: "fact",
  space_match: "fact",
  building_age: "fact",
  community_quality: "ai",
  property_management: "fact",
  budget_match: "fact",
  transaction_price_reasonableness: "fact",
  liquidity: "ai",
  value_preservation: "ai",
};

export const DIMENSION_TYPE_LABELS: Record<DimensionType, string> = {
  fact: "房源事实",
  preference: "偏好匹配",
  ai: "AI分析",
};

export const AI_DIMENSIONS = new Set<DimensionKey>(
  Object.entries(DIMENSION_TYPES)
    .filter(([, type]) => type === "ai")
    .map(([key]) => key as DimensionKey),
);

export const CRITICAL_INPUT_LABELS = {
  commute: "通勤时间",
  comparables: "近期成交",
  education: "教育信息",
  propertyManagement: "物业信息",
} as const;
