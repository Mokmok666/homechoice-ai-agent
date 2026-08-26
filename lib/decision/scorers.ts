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
import type { DimensionWebEvidence, PropertyWebEvidence, WebEvidenceFact } from "../web-evidence/types";
import { normalizePropertyName } from "../web-evidence/relevance";
import { validateMetroDistance, validateTextField } from "./dataQuality";
import { AI_DIMENSIONS, BASE_WEIGHTS, DIMENSION_LABELS } from "./dimensions";

interface ScoringContext {
  property: Property;
  preferences: BuyerPreferences;
  asOfDate: string;
  weights: Record<DimensionKey, number>;
  geoEvidence?: PropertyGeoEvidence;
  webEvidence?: PropertyWebEvidence;
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
    const busAvailable = geo.busEvidenceAvailable === true;
    const busDistance = geo.nearestBusStopDistanceMeters;
    const busCount500 = geo.busStopCountWithin500m ?? 0;
    const busCount800 = geo.busStopCountWithin800m ?? 0;
    const metroScore = distance === undefined ? null : distance <= 800 ? 100 : distance <= 1200 ? 80 : distance <= 1500 ? 60 : 20;
    const busScore = !busAvailable ? null
      : busDistance === undefined ? 20
        : busDistance <= 300 && busCount500 >= 3 && busCount800 >= 5 ? 85
          : busDistance <= 300 && busCount500 >= 1 ? 80
            : busDistance <= 500 ? 70
              : busDistance <= 800 ? 50 : 30;
    // Metro is the strongest signal. Strong bus coverage can compensate for a distant metro,
    // but a missing bus request never becomes a fabricated bus penalty.
    const score = metroScore === null
      ? busScore
      : distance! <= 800 ? 100
        : distance! <= 1200 ? Math.max(metroScore, busScore ?? 0)
          : distance! <= 1500 ? Math.max(metroScore, busScore ?? 0)
            : busScore === null ? null : Math.min(80, busScore);
    if (score === null) {
      return partial(
        context,
        "public_transport",
        [{ source: "amap", quality: geoEvidenceQuality(geo.quality), description: `${geo.observation}。来源：高德地图` }],
        ["最近地铁距离较远，公交覆盖证据暂不可用"],
      );
    }
    return evaluation(context, "public_transport", {
      score,
      status: "partial",
      evidence: [{
        source: "amap",
        quality: geoEvidenceQuality(geo.quality),
        description: `${geo.observation}。来源：高德地图`,
      }],
      missingInputs: [
        "当前站点距离为直线距离，不代表实际步行距离",
        ...(!busAvailable ? ["公交覆盖证据暂不可用"] : []),
      ],
    });
  }
  if (property.source !== "manual" || property.metroDistance === null || validateMetroDistance(property.metroDistance).status !== "valid") {
    return unknown(context, "public_transport", ["地铁或公交可达性证据"]);
  }
  const distance = property.metroDistance;
  if (distance > 1500) {
    return partial(
      context,
      "public_transport",
      [{ source: "manual", quality: 0.7, description: `距最近地铁站约 ${distance} 米，已超出通常步行可达范围` }],
      ["公交站距离与覆盖情况"],
    );
  }
  const score = distance <= 800 ? 100 : distance <= 1200 ? 80 : 60;
  return evaluation(context, "public_transport", {
    score,
    status: "partial",
    evidence: [{ source: "manual", quality: 0.8, description: `距最近地铁站约 ${distance} 米` }],
    missingInputs: ["真实步行路径、站点服务能力与公交覆盖"],
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
  const count = geo.countWithin2000m;
  const distance = geo.nearestDistanceMeters;
  const distanceScore = count === 0 || distance === undefined ? 20 : distance <= 800 ? 92 : distance <= 1_500 ? 82 : distance <= 2_000 ? 68 : 30;
  const countAdjustment = count >= 4 ? 8 : count >= 2 ? 5 : 0;
  return evaluation(context, "commercial_amenities", {
    score: Math.min(100, distanceScore + countAdjustment),
    status: geoDimensionStatus(geo.status),
    evidence: [{
      source: "amap",
      quality: geoEvidenceQuality(geo.quality),
      description: `${geo.observation}${geo.examples.length > 0 ? `；有效商业体：${geo.examples.join("、")}` : ""}。来源：高德地图`,
    }],
    missingInputs: geo.status === "partial" ? ["地址定位精度为街道级，POI 结果仅作阶段性参考"] : [],
  });
}

export function scoreMedicalAmenities(context: ScoringContext): DimensionEvaluation {
  const geo = context.geoEvidence?.medical_amenities;
  if (!isUsableGeoEvidence(geo)) {
    return unknown(context, "medical_amenities", ["可靠地址与高德地图正规医院证据"]);
  }
  const count = geo.hospitalCountWithin3000m;
  const distance = geo.nearestDistanceMeters;
  const distanceScore = count === 0 || distance === undefined ? 20 : distance <= 1_500 ? 85 : distance <= 3_000 ? 70 : 30;
  const countAdjustment = count >= 3 ? 12 : count === 2 ? 8 : 0;
  return evaluation(context, "medical_amenities", {
    score: Math.min(100, distanceScore + countAdjustment),
    status: geoDimensionStatus(geo.status),
    evidence: [{
      source: "amap",
      quality: geoEvidenceQuality(geo.quality),
      description: `${geo.observation}${geo.examples.length > 0 ? `；医院：${geo.examples.join("、")}` : ""}。来源：高德地图；未据此推断医院等级`,
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
      status: "partial",
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

function webDimension(context: ScoringContext, key: DimensionKey): DimensionWebEvidence | undefined {
  return context.webEvidence?.dimensions.find((dimension) => dimension.dimensionKey === key);
}

function factText(fact: WebEvidenceFact): string {
  return `${fact.sourceTitle} ${fact.claim}`;
}

function isProjectSpecificFact(property: Property, fact: WebEvidenceFact): boolean {
  const name = normalizePropertyName(property.confirmedLocation?.name ?? property.name);
  return name.length >= 2 && normalizePropertyName(factText(fact)).includes(name);
}

function hasCredibleSupport(facts: WebEvidenceFact[]): boolean {
  if (facts.some((fact) => fact.confidence === "high")) return true;
  return new Set(facts.filter((fact) => fact.confidence === "medium").map((fact) => fact.sourceDomain ?? fact.sourceUrl)).size >= 2;
}

export function scoreEducation(context: ScoringContext): DimensionEvaluation {
  const { property, preferences } = context;
  const hasSchool = validateTextField(property.schoolInformation).status === "valid";
  if (preferences.educationNeed === "none") {
    return evaluation(context, "education", {
      score: null,
      status: "known",
      evidence: [
        { source: "buyer_preference", quality: 1, description: "家庭当前未将教育资源作为购房约束" },
        ...(hasSchool ? [{ source: "manual" as const, quality: 0.7, description: `已记录学校线索：${property.schoolInformation}，仅作信息展示` }] : []),
      ],
      missingInputs: [],
    });
  }

  const web = webDimension(context, "education");
  const officialRelationshipFacts = (web?.facts ?? []).filter((fact) =>
    fact.confidence === "high" &&
    isProjectSpecificFact(property, fact) &&
    /招生范围|服务范围|对口|划片|学区范围|入学范围/.test(factText(fact)),
  );
  const evidence: DecisionEvidence[] = [
    { source: "buyer_preference", quality: 1, description: `家庭${preferences.educationNeed === "current" ? "当前" : "未来"}有教育需求` },
    ...(hasSchool ? [{ source: "manual" as const, quality: 0.7, description: `用户关注学校：${property.schoolInformation}` }] : []),
  ];
  if (officialRelationshipFacts.length > 0) {
    return evaluation(context, "education", {
      // This score represents an official relationship signal, never guaranteed admission.
      score: 80,
      status: "partial",
      evidence: [
        ...evidence,
        { source: "web", quality: 0.9, description: "官方公开信息显示房源与所关注教育服务范围存在关联；具体资格仍以当年政策为准" },
      ],
      missingInputs: ["当年招生政策、户籍房产条件与实际入学资格"],
    });
  }
  return partial(
    context,
    "education",
    evidence,
    [hasSchool ? "学校关系仍需当前官方招生政策核验" : "可记录关注学校，并以官方招生政策核验房源关系"],
  );
}

const PROJECT_SERVICE_SCORES = { positive: 75, mixed: 55, negative: 35 } as const;

export function scorePropertyManagement(context: ScoringContext): DimensionEvaluation {
  const { property } = context;
  const managementKnown = validateTextField(property.propertyManagementInformation).status === "valid";
  const manualEvidence: DecisionEvidence[] = managementKnown
    ? [{ source: "manual", quality: 0.75, description: `已记录管理主体：${property.propertyManagementInformation}` }]
    : [];
  const web = webDimension(context, "property_management");
  const performanceFacts = (web?.facts ?? []).filter((fact) =>
    fact.confidence !== "low" &&
    isProjectSpecificFact(property, fact) &&
    /物业服务|物业管理|维修|维护|保洁|安保|投诉|响应|公共区域|公区|服务体验/.test(factText(fact)),
  );
  if (!hasCredibleSupport(performanceFacts)) {
    return managementKnown
      ? partial(context, "property_management", manualEvidence, ["项目级物业服务、维护与真实体验证据"])
      : unknown(context, "property_management", ["物业管理主体与项目级服务证据"]);
  }
  const text = performanceFacts.map(factText).join(" ");
  const positive = /维护良好|服务良好|响应及时|满意|规范服务|示范项目|优秀服务|品质服务/.test(text);
  const negative = /投诉|维权|服务差|管理混乱|失修|维修不及时|卫生差|乱收费|纠纷/.test(text);
  if (!positive && !negative) {
    return partial(
      context,
      "property_management",
      [...manualEvidence, { source: "web", quality: 0.75, description: "已有项目级物业服务资料，但不足以判断实际服务表现" }],
      ["稳定的项目服务评价与维护记录"],
    );
  }
  const score = positive && negative ? PROJECT_SERVICE_SCORES.mixed : positive ? PROJECT_SERVICE_SCORES.positive : PROJECT_SERVICE_SCORES.negative;
  return evaluation(context, "property_management", {
    score,
    status: "partial",
    evidence: [
      ...manualEvidence,
      { source: "web", quality: 0.8, description: positive && negative ? "可信项目级资料同时存在正向服务记录与投诉线索" : positive ? "可信项目级资料包含明确的服务或维护正向记录" : "可信项目级资料包含明确的服务投诉或维护风险线索" },
    ],
    missingInputs: ["仍建议通过现场公区状态、收费标准与住户体验交叉核验"],
  });
}

const VALUE_PRESERVATION_COMPONENTS = [
  "location_maturity",
  "public_transport",
  "commercial_amenities",
  "liquidity",
  "building_age",
  "community_quality",
] as const satisfies readonly DimensionKey[];
const MIN_VALUE_COMPONENTS = 3;
const MIN_VALUE_COMPONENT_BASE_WEIGHT = 15;

export function scoreValuePreservation(
  context: ScoringContext,
  evaluated: DimensionEvaluation[],
): DimensionEvaluation {
  const components = VALUE_PRESERVATION_COMPONENTS.flatMap((key) => {
    const item = evaluated.find((dimension) => dimension.key === key);
    return item?.score === null || item?.score === undefined ? [] : [item];
  });
  const componentWeight = components.reduce((sum, item) => sum + item.baseWeight, 0);
  if (components.length < MIN_VALUE_COMPONENTS || componentWeight < MIN_VALUE_COMPONENT_BASE_WEIGHT) {
    return unknown(context, "value_preservation", [`至少 ${MIN_VALUE_COMPONENTS} 项、合计基础权重不少于 ${MIN_VALUE_COMPONENT_BASE_WEIGHT} 的结构性维度评分`]);
  }
  const score = Math.round(components.reduce((sum, item) => sum + (item.score ?? 0) * item.baseWeight, 0) / componentWeight);
  return evaluation(context, "value_preservation", {
    score,
    status: components.every((item) => item.status === "known") ? "known" : "partial",
    evidence: [{
      source: "derived",
      quality: components.reduce((sum, item) => sum + item.evidenceQuality, 0) / components.length,
      description: `由 ${components.map((item) => `${DIMENSION_LABELS[item.key]} ${item.score}分`).join("、")} 的结构性评分加权派生；不代表房价上涨预测`,
    }],
    missingInputs: components.length < VALUE_PRESERVATION_COMPONENTS.length ? ["更多地段、交通、流动性、楼龄或小区品质证据可提高稳定性判断"] : [],
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
    public_transport: "公共交通证据",
    commercial_amenities: "商业配套证据",
    education: "学校信息",
    medical_amenities: "正规医院可达性证据",
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
  const evaluated: DimensionEvaluation[] = [];
  for (const key of DIMENSION_KEYS) {
    let result: DimensionEvaluation;
    if (key === "budget_match") result = scoreBudgetMatch(context);
    else if (key === "commute") result = scoreCommute(context);
    else if (key === "public_transport") result = scorePublicTransport(context);
    else if (key === "commercial_amenities") result = scoreCommercialAmenities(context);
    else if (key === "medical_amenities") result = scoreMedicalAmenities(context);
    else if (key === "building_age") result = scoreBuildingAge(context);
    else if (key === "transaction_price_reasonableness") result = scoreTransactionPriceReasonableness(context);
    else if (key === "education") result = scoreEducation(context);
    else if (key === "property_management") result = scorePropertyManagement(context);
    else if (key === "value_preservation") result = scoreValuePreservation(context, evaluated);
    else result = scoreUnscoredDimension(context, key);
    evaluated.push(result);
  }
  return evaluated;
}
