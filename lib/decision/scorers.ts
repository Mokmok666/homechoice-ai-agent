import {
  resolvePartnerCommutePreference,
  resolvePrimaryCommutePreference,
  type BuyerPreferences,
} from "../../types/buyer-preferences";
import { FAMILY_COMMUTE_WEIGHTS } from "../commute-evidence";
import {
  DIMENSION_KEYS,
  type DecisionEvidence,
  type DimensionEvaluation,
  type DimensionKey,
} from "../../types/decision";
import type { ComparableTransaction, Property } from "../../types/property";
import type { GeoEvidenceQuality, PropertyGeoEvidence } from "../../types/geo-evidence";
import { validateMetroDistance, validateTextField } from "./dataQuality";
import { AI_DIMENSIONS, BASE_WEIGHTS } from "./dimensions";

interface ScoringContext {
  property: Property;
  preferences: BuyerPreferences;
  asOfDate: string;
  weights: Record<DimensionKey, number>;
  geoEvidence?: PropertyGeoEvidence;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function linear(value: number, start: number, end: number, startScore: number, endScore: number): number {
  const progress = (value - start) / (end - start);
  return startScore + progress * (endScore - startScore);
}

function geoEvidenceQuality(quality: GeoEvidenceQuality): number {
  return quality === "high" ? 0.95 : quality === "medium" ? 0.75 : 0.4;
}

function geoDimensionStatus(status: "verified" | "partial"): "known" | "partial" {
  return status === "verified" ? "known" : "partial";
}

function isUsableGeoEvidence(evidence: { status: string; quality: GeoEvidenceQuality } | undefined): evidence is { status: "verified" | "partial"; quality: "high" | "medium" } {
  return evidence !== undefined && evidence.status !== "insufficient" && evidence.quality !== "low";
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
  const geo = context.geoEvidence?.public_transport;
  if (isUsableGeoEvidence(geo)) {
    const distance = geo.nearestDistanceMeters;
    const baseScore = distance <= 500 ? 100 : distance <= 800 ? 90 : distance <= 1200 ? 75 : distance <= 2000 ? 50 : 20;
    const score = Math.min(100, baseScore + (geo.stationCountWithin1000m >= 2 ? 5 : 0));
    return evaluation(context, "public_transport", {
      score,
      status: "partial",
      evidence: [{
        source: "amap",
        quality: geoEvidenceQuality(geo.quality),
        description: `${geo.observation}；1 公里内主站 ${geo.stationCountWithin1000m} 个。来源：高德地图`,
      }],
      missingInputs: ["当前为直线距离，不代表实际步行距离"],
    });
  }
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

export function scoreCommute(context: ScoringContext): DimensionEvaluation {
  const { preferences } = context;
  const primaryPreference = resolvePrimaryCommutePreference(preferences);
  const partnerPreference = resolvePartnerCommutePreference(preferences);
  if (primaryPreference.mode === "not_important") {
    return evaluation(context, "commute", {
      score: null,
      status: "known",
      evidence: [{ source: "buyer_preference", quality: 1, description: "已记录：通勤不是家庭的关键约束" }],
      missingInputs: [],
    });
  }
  const geo = context.geoEvidence?.commute;
  if (
    !primaryPreference.workLocation || primaryPreference.idealMinutes === null || primaryPreference.maxMinutes === null ||
    primaryPreference.idealMinutes < 0 || primaryPreference.maxMinutes < primaryPreference.idealMinutes
  ) {
    return partial(
      context,
      "commute",
      primaryPreference.workLocation
        ? [{ source: "buyer_preference", quality: 1, description: `已记录主要工作地点：${primaryPreference.workLocation}` }]
        : [],
      ["完整通勤偏好与主要工作地点"],
    );
  }
  const primary = geo?.primary;
  const partner = geo?.partner;
  const legacyMinutes = geo?.durationMinutes;
  const primaryMinutes = primary?.selectedMinutes ?? legacyMinutes;
  if (!isUsableGeoEvidence(geo) || primaryMinutes === undefined) {
    return partial(
      context,
      "commute",
      [
        { source: "buyer_preference", quality: 1, description: `已记录主要工作地点：${primaryPreference.workLocation}` },
        ...(partner?.selectedMinutes !== undefined && partnerPreference
          ? [{ source: "amap" as const, quality: geoEvidenceQuality(partner.quality), description: `伴侣到 ${partnerPreference.workLocation} 的路线约 ${partner.selectedMinutes} 分钟；主通勤缺失时不单独生成家庭通勤分。来源：高德地图` }]
          : []),
      ],
      ["高德地图主通勤路线时间"],
    );
  }

  const scoreForMinutes = (actual: number, ideal: number, maximum: number): number => {
    if (actual <= ideal) return 100;
    if (actual <= maximum) return ideal === maximum ? 60 : linear(actual, ideal, maximum, 100, 60);
    if (actual <= maximum + 15) return 40;
    if (actual <= maximum + 30) return 20;
    return 0;
  };
  const primaryScore = scoreForMinutes(primaryMinutes, primaryPreference.idealMinutes, primaryPreference.maxMinutes);
  const partnerUsable = partnerPreference && partner?.selectedMinutes !== undefined && partnerPreference.idealMinutes !== null && partnerPreference.maxMinutes !== null;
  const partnerScore = partnerUsable
    ? scoreForMinutes(partner.selectedMinutes!, partnerPreference.idealMinutes!, partnerPreference.maxMinutes!)
    : null;
  const score = partnerScore === null
    ? primaryScore
    : primaryScore * FAMILY_COMMUTE_WEIGHTS.primary + partnerScore * FAMILY_COMMUTE_WEIGHTS.partner;
  const modeLabel = (mode: string | undefined) => mode === "driving" ? "驾车" : mode === "transit" ? "公共交通" : mode === "walking" ? "步行" : mode === "cycling" ? "骑行" : "路线";
  const primaryDistance = primary?.selectedMode ? primary.modeResults[primary.selectedMode]?.distanceMeters : geo.distanceMeters;
  const partnerDescription = partnerScore !== null && partner?.selectedMinutes !== undefined
    ? `伴侣到 ${partnerPreference!.workLocation} ${modeLabel(partner.selectedMode)}约 ${partner.selectedMinutes} 分钟`
    : partnerPreference ? "伴侣路线暂不可用，本次未按 0 分计入" : null;

  return evaluation(context, "commute", {
    score: Math.round(clamp(score)),
    status: geoDimensionStatus(geo.status),
    evidence: [
      { source: "amap", quality: geoEvidenceQuality(geo.quality), description: `${primary ? `到 ${primaryPreference.workLocation} ${modeLabel(primary.selectedMode)}约 ${primaryMinutes} 分钟` : geo.observation}${primaryDistance ? `，路线距离约 ${Math.round(primaryDistance / 100) / 10} 公里` : ""}。来源：高德地图` },
      ...(partnerDescription ? [{ source: "amap" as const, quality: geoEvidenceQuality(geo.quality), description: `${partnerDescription}。来源：高德地图` }] : []),
      { source: "buyer_preference", quality: 1, description: `你的理想 ${primaryPreference.idealMinutes} 分钟，最长可接受 ${primaryPreference.maxMinutes} 分钟${partnerPreference && partnerPreference.idealMinutes !== null && partnerPreference.maxMinutes !== null ? `；伴侣理想 ${partnerPreference.idealMinutes} 分钟，最长 ${partnerPreference.maxMinutes} 分钟` : ""}` },
    ],
    missingInputs: geo.status === "partial" ? [partnerPreference && partnerScore === null ? "伴侣通勤路线可进一步确认" : "部分路线或地址精度可进一步确认"] : [],
  });
}

export function scoreCommercialAmenities(context: ScoringContext): DimensionEvaluation {
  const geo = context.geoEvidence?.commercial_amenities;
  if (!isUsableGeoEvidence(geo)) {
    return unknown(context, "commercial_amenities", ["可靠地址与高德地图商业配套证据"]);
  }
  const count = geo.countWithin1000m;
  const baseScore = count >= 20 ? 90 : count >= 10 ? 80 : count >= 5 ? 65 : count >= 1 ? 45 : 20;
  return evaluation(context, "commercial_amenities", {
    score: Math.min(100, baseScore + (geo.hasMajorDestination ? 10 : 0)),
    status: geoDimensionStatus(geo.status),
    evidence: [{
      source: "amap",
      quality: geoEvidenceQuality(geo.quality),
      description: `${geo.observation}${geo.hasMajorDestination ? "，检测到主要商场或商业综合体" : ""}${geo.examples.length > 0 ? `；示例：${geo.examples.join("、")}` : ""}。来源：高德地图`,
    }],
    missingInputs: geo.status === "partial" ? ["地址定位精度为街道级，POI 结果仅作阶段性参考"] : [],
  });
}

function supermarketScore(count: number): number {
  return count >= 5 ? 100 : count >= 3 ? 80 : count >= 1 ? 60 : 20;
}

function medicalScore(count: number): number {
  return count >= 3 ? 100 : count === 2 ? 80 : count === 1 ? 60 : 20;
}

function parkScore(count: number): number {
  return count >= 2 ? 100 : count === 1 ? 70 : 30;
}

export function scoreDailyLifeAmenities(context: ScoringContext): DimensionEvaluation {
  const geo = context.geoEvidence?.daily_life_amenities;
  if (!isUsableGeoEvidence(geo)) {
    return unknown(context, "daily_life_amenities", ["可靠地址与高德地图生活配套证据"]);
  }
  const requiredCategories = ["supermarket", "medical", "park"] as const;
  const missingCategories = requiredCategories.filter((category) => !geo.availableCategories.includes(category));
  if (missingCategories.length > 0) {
    const labels = { supermarket: "超市", medical: "医疗", park: "公园" } as const;
    return partial(
      context,
      "daily_life_amenities",
      [{ source: "amap", quality: geoEvidenceQuality(geo.quality), description: `${geo.observation}。来源：高德地图` }],
      [`${missingCategories.map((category) => labels[category]).join("、")}分类请求暂不可用`],
    );
  }
  const score = Math.round(
    supermarketScore(geo.supermarketCount) * 0.4 +
    medicalScore(geo.medicalCount) * 0.35 +
    parkScore(geo.parkCount) * 0.25,
  );
  return evaluation(context, "daily_life_amenities", {
    score,
    status: geoDimensionStatus(geo.status),
    evidence: [{
      source: "amap",
      quality: geoEvidenceQuality(geo.quality),
      description: `${geo.observation}${geo.examples.length > 0 ? `；示例：${geo.examples.join("、")}` : ""}。来源：高德地图`,
    }],
    missingInputs: geo.status === "partial" ? ["地址定位精度为街道级，POI 结果仅作阶段性参考"] : [],
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
    if (key === "commute") return scoreCommute(context);
    if (key === "public_transport") return scorePublicTransport(context);
    if (key === "commercial_amenities") return scoreCommercialAmenities(context);
    if (key === "daily_life_amenities") return scoreDailyLifeAmenities(context);
    if (key === "building_age") return scoreBuildingAge(context);
    if (key === "transaction_price_reasonableness") return scoreTransactionPriceReasonableness(context);
    return scoreUnscoredDimension(context, key);
  });
}
