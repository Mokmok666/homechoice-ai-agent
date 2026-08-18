import type { BuyerPreferences } from "../../types/buyer-preferences";
import {
  DIMENSION_KEYS,
  type DecisionEvidence,
  type DimensionEvaluation,
  type DimensionKey,
} from "../../types/decision";
import type { ComparableTransaction, Property } from "../../types/property";
import { validateMetroDistance, validateTextField } from "./dataQuality";
import { AI_DIMENSIONS, BASE_WEIGHTS } from "./dimensions";

interface ScoringContext {
  property: Property;
  preferences: BuyerPreferences;
  asOfDate: string;
  weights: Record<DimensionKey, number>;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function linear(value: number, start: number, end: number, startScore: number, endScore: number): number {
  const progress = (value - start) / (end - start);
  return startScore + progress * (endScore - startScore);
}

function evaluation(
  context: ScoringContext,
  key: DimensionKey,
  input: Omit<DimensionEvaluation, "key" | "baseWeight" | "finalWeight" | "evidenceQuality">,
): DimensionEvaluation {
  const evidenceQuality = input.evidence.length === 0
    ? 0
    : input.evidence.reduce((sum, item) => sum + item.quality, 0) / input.evidence.length;
  return {
    key,
    baseWeight: BASE_WEIGHTS[key],
    finalWeight: context.weights[key],
    evidenceQuality,
    ...input,
  };
}

function unknown(context: ScoringContext, key: DimensionKey, missingInputs: string[]): DimensionEvaluation {
  return evaluation(context, key, {
    score: null,
    status: "unknown",
    evidence: [],
    missingInputs,
  });
}

function partial(
  context: ScoringContext,
  key: DimensionKey,
  evidence: DecisionEvidence[],
  missingInputs: string[],
): DimensionEvaluation {
  return evaluation(context, key, {
    score: null,
    status: "partial",
    evidence,
    missingInputs,
  });
}

export function scoreBudgetMatch(context: ScoringContext): DimensionEvaluation {
  const { property, preferences } = context;
  if (property.source !== "manual") return unknown(context, "budget_match", ["真实用户录入的预期成交价"]);
  const ratio = property.totalPrice / preferences.maximumBudget;
  let score: number;
  if (ratio <= 0.9) score = 100;
  else if (ratio <= 1) score = linear(ratio, 0.9, 1, 100, 80);
  else if (ratio <= 1.1) score = linear(ratio, 1, 1.1, 80, 20);
  else if (ratio <= 1.2) score = linear(ratio, 1.1, 1.2, 20, 0);
  else score = 0;

  return evaluation(context, "budget_match", {
    score: Math.round(clamp(score)),
    status: "known",
    evidence: [
      { source: "manual", quality: 0.8, description: `预期成交价 ${property.totalPrice} 万元` },
      { source: "buyer_preference", quality: 1, description: `最高预算 ${preferences.maximumBudget} 万元` },
    ],
    missingInputs: [],
  });
}

export function scorePublicTransport(context: ScoringContext): DimensionEvaluation {
  const { property } = context;
  if (property.source !== "manual" || property.metroDistance === null || validateMetroDistance(property.metroDistance).status !== "valid") {
    return unknown(context, "public_transport", ["到最近轨道交通站的距离"]);
  }
  const distance = property.metroDistance;
  const score = distance <= 500 ? 100 : distance <= 800 ? 85 : distance <= 1200 ? 70 : distance <= 2000 ? 50 : 30;
  return evaluation(context, "public_transport", {
    score,
    status: "partial",
    evidence: [{ source: "manual", quality: 0.8, description: `距最近地铁站约 ${distance} 米` }],
    missingInputs: ["真实步行路径与站点服务能力"],
  });
}

export function scoreBuildingAge(context: ScoringContext): DimensionEvaluation {
  const { property, asOfDate } = context;
  if (property.source !== "manual" || property.deliveryYear === null || property.deliveryYear === undefined) {
    return unknown(context, "building_age", ["交付年份"]);
  }
  const asOfYear = Number(asOfDate.slice(0, 4));
  if (!Number.isInteger(asOfYear) || property.deliveryYear < 1900 || property.deliveryYear > asOfYear + 3) {
    return unknown(context, "building_age", ["有效的交付年份"]);
  }
  const age = Math.max(0, asOfYear - property.deliveryYear);
  const score = age <= 5 ? 100 : age <= 10 ? 90 : age <= 15 ? 80 : age <= 20 ? 65 : age <= 30 ? 45 : 25;
  return evaluation(context, "building_age", {
    score,
    status: "known",
    evidence: [{ source: "manual", quality: 0.8, description: `${property.deliveryYear} 年交付，分析时楼龄约 ${age} 年` }],
    missingInputs: [],
  });
}

function isRecentConfirmed(transaction: ComparableTransaction, asOfDate: string): boolean {
  if (!transaction.confirmed || transaction.price <= 0 || transaction.area <= 0 || validateTextField(transaction.source).status !== "valid") return false;
  const transactionTime = Date.parse(`${transaction.transactionDate}T00:00:00Z`);
  const asOfTime = Date.parse(`${asOfDate}T00:00:00Z`);
  if (!Number.isFinite(transactionTime) || !Number.isFinite(asOfTime) || transactionTime > asOfTime) return false;
  const [year, month, day] = asOfDate.split("-").map(Number);
  const cutoffTime = Date.UTC(year, month - 1 - 24, day);
  return transactionTime >= cutoffTime;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function scoreTransactionPriceReasonableness(context: ScoringContext): DimensionEvaluation {
  const { property, asOfDate } = context;
  if (property.source !== "manual") {
    return unknown(context, "transaction_price_reasonableness", ["真实用户录入的近期成交参考"]);
  }
  const transactions = property.comparableTransactions ?? [];
  const valid = transactions.filter((item) => isRecentConfirmed(item, asOfDate));
  if (transactions.length === 0) {
    return partial(
      context,
      "transaction_price_reasonableness",
      [{ source: "manual", quality: 0.8, description: `已记录预期成交价 ${property.totalPrice} 万元` }],
      ["近期成交参考可进一步确认"],
    );
  }
  if (valid.length < 3) {
    const evidence = [{
      source: "manual" as const,
      quality: 0.6,
      description: `已录入 ${transactions.length} 条成交参考，其中 ${valid.length} 条为近 24 个月已确认记录`,
    }];
    return evaluation(context, "transaction_price_reasonableness", {
      score: null,
      status: "known",
      evidence,
      missingInputs: ["增加至 3 条近 24 个月已确认记录可计算价格合理性"],
    });
  }

  const targetUnitPrice = property.totalPrice / property.area;
  const medianUnitPrice = median(valid.map((item) => item.price / item.area));
  const ratio = targetUnitPrice / medianUnitPrice;
  let score: number;
  if (ratio <= 0.95) score = 100;
  else if (ratio <= 1) score = linear(ratio, 0.95, 1, 100, 95);
  else if (ratio <= 1.05) score = linear(ratio, 1, 1.05, 95, 80);
  else if (ratio <= 1.1) score = linear(ratio, 1.05, 1.1, 80, 60);
  else if (ratio <= 1.2) score = linear(ratio, 1.1, 1.2, 60, 30);
  else score = 0;

  return evaluation(context, "transaction_price_reasonableness", {
    score: Math.round(clamp(score)),
    status: "known",
    evidence: [{
      source: "confirmed_comparable",
      quality: 0.9,
      description: `基于 ${valid.length} 条近 24 个月已确认成交参考的单价中位数`,
    }],
    missingInputs: [],
  });
}

function scoreUnscoredDimension(context: ScoringContext, key: DimensionKey): DimensionEvaluation {
  const { property, preferences } = context;
  if (property.source !== "manual") return unknown(context, key, ["真实用户房源证据"]);

  if (AI_DIMENSIONS.has(key)) {
    return unknown(context, key, ["未来结合结构化事实与可靠外部证据进行 AI 分析"]);
  }

  if (key === "location_maturity" && [property.city, property.district, property.address].some((value) => validateTextField(value).status === "valid")) {
    return partial(
      context,
      key,
      [{ source: "manual", quality: 0.8, description: `已记录房源位置：${property.city} · ${property.district} · ${property.address}` }],
      ["未来可结合商业配套、公共服务、交通、区域发展与可靠外部信息进一步分析地段成熟度"],
    );
  }
  if (key === "commute") {
    if (preferences.commuteMode === "not_important") {
      return evaluation(context, key, { score: null, status: "known", evidence: [{ source: "buyer_preference", quality: 1, description: "已记录：通勤不是家庭的关键约束" }], missingInputs: [] });
    }
    if (preferences.primaryWorkLocation.trim()) {
      return partial(context, key, [{ source: "buyer_preference", quality: 1, description: `已记录主要工作地点：${preferences.primaryWorkLocation}` }], ["真实通勤时间将在后续地图能力中核验"]);
    }
    return unknown(context, key, ["主要工作地点可提升通勤分析"]);
  }
  if (key === "education") {
    const hasValidSchoolInformation = validateTextField(property.schoolInformation).status === "valid";
    if (preferences.educationNeed === "none") {
      const noNeedEvidence: DecisionEvidence[] = [{ source: "buyer_preference", quality: 1, description: "已记录：家庭暂无教育需求" }];
      if (hasValidSchoolInformation) {
        noNeedEvidence.push({ source: "manual", quality: 0.7, description: `已记录学校信息：${property.schoolInformation}` });
      }
      return evaluation(context, key, { score: null, status: "known", evidence: noNeedEvidence, missingInputs: [] });
    }
    const educationEvidence: DecisionEvidence[] = [{
      source: "buyer_preference",
      quality: 1,
      description: `已记录学校需求：${preferences.educationNeed === "current" ? "当前有教育需求" : "未来有教育需求"}`,
    }];
    if (hasValidSchoolInformation) {
      educationEvidence.push({ source: "manual", quality: 0.7, description: `已记录学校信息：${property.schoolInformation}` });
    }
    return partial(
      context,
      key,
      educationEvidence,
      hasValidSchoolInformation ? ["学校信息仍需可靠来源核验"] : ["录入具体学校信息可进一步确认"],
    );
  }
  if (key === "layout_design" && property.layout.trim()) {
    return evaluation(context, key, {
      score: null,
      status: "known",
      evidence: [{ source: "manual", quality: 0.9, description: `已记录户型：${property.layout}` }],
      missingInputs: [],
    });
  }
  if (key === "space_match" && property.area > 0) {
    return evaluation(context, key, {
      score: null,
      status: "known",
      evidence: [{ source: "manual", quality: 0.9, description: `已记录建筑面积：${property.area}㎡` }],
      missingInputs: ["家庭空间需求可进一步提升匹配分析"],
    });
  }
  if (key === "property_management" && validateTextField(property.propertyManagementInformation).status === "valid") {
    return partial(context, key, [{ source: "manual", quality: 0.7, description: `已记录物业信息：${property.propertyManagementInformation}` }], ["物业信息仍需可靠来源核验"]);
  }
  const missing: Record<DimensionKey, string> = {
    location_maturity: "成熟度相关结构化配套证据",
    commute: "真实通勤时间",
    public_transport: "轨道交通证据",
    commercial_amenities: "商业配套证据",
    education: "学校信息",
    daily_life_amenities: "日常生活配套证据",
    layout_design: "户型图或结构化空间证据",
    space_match: "家庭空间需求",
    building_age: "交付年份",
    community_quality: "小区环境与公共空间证据",
    property_management: "物业信息",
    budget_match: "最高预算与预期成交价",
    transaction_price_reasonableness: "近期成交参考",
    liquidity: "流动性相关结构化证据",
    value_preservation: "长期保值相关结构化证据",
  };
  return unknown(context, key, [missing[key]]);
}

export function evaluateDimensions(context: ScoringContext): DimensionEvaluation[] {
  return DIMENSION_KEYS.map((key) => {
    if (key === "budget_match") return scoreBudgetMatch(context);
    if (key === "public_transport") return scorePublicTransport(context);
    if (key === "building_age") return scoreBuildingAge(context);
    if (key === "transaction_price_reasonableness") return scoreTransactionPriceReasonableness(context);
    return scoreUnscoredDimension(context, key);
  });
}
