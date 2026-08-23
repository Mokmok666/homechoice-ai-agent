import type { DimensionKey, DimensionType } from "../../types/decision";
import { DECISION_FRAMEWORK_BY_KEY } from "./framework";

export const BASE_WEIGHTS = Object.fromEntries(
  Object.entries(DECISION_FRAMEWORK_BY_KEY).map(([key, value]) => [key, value.baseWeight]),
) as Record<DimensionKey, number>;

export const DIMENSION_LABELS = Object.fromEntries(
  Object.entries(DECISION_FRAMEWORK_BY_KEY).map(([key, value]) => [key, value.label]),
) as Record<DimensionKey, string>;

export const DIMENSION_TYPES = Object.fromEntries(
  Object.entries(DECISION_FRAMEWORK_BY_KEY).map(([key, value]) => [key, value.dimensionType]),
) as Record<DimensionKey, DimensionType>;

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
