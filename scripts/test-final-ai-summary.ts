import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDeterministicKnownNarrative } from "../lib/ai/deterministic-narrative";
import { createAIAnalysisPrompt } from "../lib/ai/prompt";
import { createAIAnalysisRequest } from "../lib/ai/request";
import { validateAIAnalysisResponse } from "../lib/ai/validation";
import { runDecisionEngine } from "../lib/decision/engine";
import type { AIAnalysis, AIAnalysisRequest } from "../types/ai-analysis";
import type { BuyerPreferences, DecisionPriority } from "../types/buyer-preferences";
import type { Property } from "../types/property";
import type { GeoEvidenceByProperty } from "../types/geo-evidence";

const now = "2026-08-30T00:00:00.000Z";

function property(id: string, overrides: Partial<Property> = {}): Property {
  return {
    id,
    name: `候选${id}`,
    city: "佛山市",
    district: "禅城区",
    address: `${id}路1号`,
    totalPrice: 238,
    listingPrice: 255,
    area: 105,
    layout: "3室2厅2卫",
    rooms: 3,
    livingRooms: 2,
    bathrooms: 2,
    floor: "中楼层",
    floorLevel: "middle",
    floorNumber: 10,
    totalFloors: 30,
    metroDistance: null,
    schoolInformation: "",
    propertyManagementInformation: "",
    propertyCompany: null,
    propertyFee: null,
    greenRatio: null,
    parkingRatio: null,
    propertyManagementExperience: "unknown",
    publicAreaMaintenance: "unknown",
    communityEnvironmentExperience: "unknown",
    noiseExperience: "unknown",
    parkingExperience: "unknown",
    maintenanceCondition: "unknown",
    propertyExperience: null,
    environment: null,
    noise: null,
    parking: null,
    publicArea: null,
    actualCommuteExperience: null,
    recentDealPrice: null,
    comparableTransactions: [],
    deliveryYear: 2020,
    orientation: "south",
    status: "completed",
    source: "manual",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function preferences(topPriorities: DecisionPriority[], maximumBudget = 300): BuyerPreferences {
  return {
    id: "preferences",
    purchasePurpose: "self_use",
    maximumBudget,
    primaryWorkLocation: "",
    partnerWorkLocation: null,
    commuteMode: "not_important",
    idealCommuteMinutes: null,
    maxCommuteMinutes: null,
    primaryCommuteMode: "not_important",
    primaryIdealCommuteMinutes: null,
    primaryMaxCommuteMinutes: null,
    educationNeed: "none",
    educationStages: [],
    topPriorities,
    createdAt: now,
    updatedAt: now,
  };
}

const candidates = [
  property("a", {
    name: "澄园",
    totalPrice: 248,
    area: 102,
    deliveryYear: 2023,
    communityEnvironmentExperience: "very_good",
    propertyManagementExperience: "good",
  }),
  property("b", {
    name: "雅庭",
    totalPrice: 218,
    area: 132,
    deliveryYear: 2012,
    communityEnvironmentExperience: "average",
    propertyManagementExperience: "average",
  }),
];

function requestFor(topPriorities: DecisionPriority[], maximumBudget = 300, geoEvidenceByProperty: GeoEvidenceByProperty = {}): AIAnalysisRequest {
  const buyer = preferences(topPriorities, maximumBudget);
  const engine = runDecisionEngine({ properties: candidates, preferences: buyer, geoEvidenceByProperty, asOfDate: "2026-08-30" });
  return createAIAnalysisRequest({ properties: candidates, preferences: buyer, engine, geoEvidenceByProperty });
}

const verifiedAmap: GeoEvidenceByProperty = {
  a: {
    commute: {
      dimension: "commute", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "路线已核验",
      primary: { destinationLabel: "工作地点", requestedMode: "driving", modeResults: { driving: { minutes: 32, distanceMeters: 18000 } }, selectedMode: "driving", selectedMinutes: 32, status: "verified", quality: "high", fetchedAt: now },
    },
    commercial_amenities: { dimension: "commercial_amenities", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "商业体已核验", countWithin2000m: 3, nearestDistanceMeters: 680, nearestName: "中心广场", examples: ["中心广场"] },
    medical_amenities: { dimension: "medical_amenities", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "医院已核验", hospitalCountWithin3000m: 1, nearestDistanceMeters: 1200, nearestName: "市人民医院", examples: ["市人民医院"] },
  },
  b: {
    commute: {
      dimension: "commute", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "路线已核验",
      primary: { destinationLabel: "工作地点", requestedMode: "driving", modeResults: { driving: { minutes: 46, distanceMeters: 25000 } }, selectedMode: "driving", selectedMinutes: 46, status: "verified", quality: "high", fetchedAt: now },
    },
    commercial_amenities: { dimension: "commercial_amenities", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "商业体已核验", countWithin2000m: 1, nearestDistanceMeters: 1500, nearestName: "邻里中心", examples: ["邻里中心"] },
    medical_amenities: { dimension: "medical_amenities", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "医院已核验", hospitalCountWithin3000m: 1, nearestDistanceMeters: 2400, nearestName: "区人民医院", examples: ["区人民医院"] },
  },
};

function validate(request: AIAnalysisRequest, analysis: AIAnalysis) {
  return validateAIAnalysisResponse(
    {
      ok: true,
      analysis,
      metadata: { generatedAt: now, inputSignature: request.inputSignature, provider: "zhipu", model: "summary-test" },
    },
    request.context.authoritativeTopPropertyId,
    request.context.candidates[0]?.property.name ?? undefined,
    request.context.candidates.slice(1, 2).flatMap((candidate) => candidate.property.name ? [candidate.property.name] : []),
    false,
    {
      educationNeed: request.context.preferences.educationNeed,
      comparisons: request.context.candidateComparisons,
      topPropertyName: request.context.candidates[0]?.property.name ?? undefined,
      dimensions: request.context.candidates[0]?.decision.dimensions.map((dimension) => ({ key: dimension.key, label: dimension.label, score: dimension.score, status: dimension.status })) ?? [],
      evidencePack: request.evidencePack,
      effectivePriorities: request.effectivePriorities,
      knownDecisionContext: request.knownDecisionContext,
      requireEvidenceGroundedStructure: true,
    },
  );
}

// A/B/F: normal recommendation, realistic price/space trade-off and alternative strength.
const normal = requestFor(["community_quality", "property_management", "price"]);
const normalFallback = createDeterministicKnownNarrative(normal.knownDecisionContext);
assert.equal(normalFallback.topPropertyId, normal.context.authoritativeTopPropertyId);
assert.ok(normalFallback.decisionSummary.includes(normal.context.candidates[0].property.name!));
assert.ok(Array.from(normalFallback.decisionSummary.replace(/\s/g, "")).length <= 200);
assert.match(normalFallback.decisionSummary, /更适合你/);
assert.match(normalFallback.decisionSummary, /小区品质|预算|交付|房龄|物业/);
assert.ok(!/\n\s*\n|关键决策依据|为什么最终推荐|风险与待确认|下一步建议/.test(normalFallback.decisionSummary));
assert.ok(!/基于你当前的购房偏好和现有可确认信息|候选之间的整体差距有限|整体匹配|当前权威排序|可比较维度|决定性因素|本轮判断/.test(normalFallback.decisionSummary));
assert.ok(!normalFallback.decisionSummary.includes(normal.context.candidates[1].property.name!), "normal summary no longer requires alternative analysis");
const normalValidation = validate(normal, normalFallback);
assert.equal(normalValidation.success, true, `A/B/F: final summary must pass full factual validation: ${normalValidation.success ? "" : `${normalValidation.errors.join(" | ")} :: ${normalFallback.decisionSummary}`}`);
const overlongValidation = validate(normal, { ...normalFallback, decisionSummary: `${normal.context.candidates[0].property.name}更适合你。${"适合当前购房需求".repeat(30)}` });
assert.equal(overlongValidation.success, false, "summary longer than 200 visible characters must be rejected");
if (!overlongValidation.success) assert.ok(overlongValidation.errors.includes("analysis.decisionSummary must not exceed 200 visible characters"));
const multilineValidation = validate(normal, { ...normalFallback, decisionSummary: `${normal.context.candidates[0].property.name}更适合你。\n因此建议优先考虑。` });
assert.equal(multilineValidation.success, false, "active summary must remain one paragraph");
const templatedOneSentence = validate(normal, { ...normalFallback, decisionSummary: `${normal.context.candidates[0].property.name}通勤便捷，周边配套完善，预算匹配度高，是您的优先选择。` });
assert.equal(templatedOneSentence.success, false, "one generic template sentence must not pass the final summary contract");
if (!templatedOneSentence.success) assert.ok(templatedOneSentence.errors.includes("analysis.decisionSummary must include concrete grounded detail"));
const denseOneSentence = validate(normal, { ...normalFallback, decisionSummary: `${normal.context.candidates[0].property.name}是您的首选，你记录的小区品质体验较好，预期成交价248万元也在300万元预算内。` });
assert.equal(denseOneSentence.success, true, "punctuation style alone must not reject a fact-complete grounded summary");
const completeTwoSentence = validate(normal, { ...normalFallback, decisionSummary: `${normal.context.candidates[0].property.name}目前更适合你。你记录的小区品质和物业服务体验较好，预期成交价248万元也在300万元预算内，因此更建议优先考虑。` });
assert.equal(completeTwoSentence.success, true, "two natural sentences with enough grounded detail must not be rejected only for sentence count");
const exposedScore = validate(normal, { ...normalFallback, decisionSummary: `${normal.context.candidates[0].property.name}目前更适合你。预算匹配度高达94%，预期成交价248万元也在300万元预算内，因此更建议优先考虑。` });
assert.equal(exposedScore.success, false, "model summaries must not expose deterministic score language");
if (!exposedScore.success) assert.ok(exposedScore.errors.includes("analysis.decisionSummary must not expose scores"));

// C: same facts, materially different priorities produce different emphasis.
const communityFirst = normalFallback.decisionSummary;
const budgetFirstRequest = requestFor(["price", "layout_and_space", "property_management"], 225);
const budgetFirst = createDeterministicKnownNarrative(budgetFirstRequest.knownDecisionContext).decisionSummary;
assert.notEqual(communityFirst, budgetFirst);
assert.notDeepEqual(
  normal.knownDecisionContext.decisiveKnownFactors.map((factor) => factor.dimension),
  budgetFirstRequest.knownDecisionContext.decisiveKnownFactors.map((factor) => factor.dimension),
  "C: preference change must alter selected deterministic emphasis",
);
assert.notEqual(communityFirst.slice(0, 80), budgetFirst.slice(0, 80), "C: summaries should not only differ in a trailing clause");

// C: verified AMap facts may be integrated naturally without exposing acquisition mechanics.
const amapBuyer: BuyerPreferences = {
  ...preferences(["commute", "commercial_amenities", "medical_amenities"]),
  primaryWorkLocation: "工作地点",
  commuteMode: "driving",
  idealCommuteMinutes: 40,
  maxCommuteMinutes: 60,
  primaryCommuteMode: "driving",
  primaryIdealCommuteMinutes: 40,
  primaryMaxCommuteMinutes: 60,
};
const amapEngine = runDecisionEngine({ properties: candidates, preferences: amapBuyer, geoEvidenceByProperty: verifiedAmap, asOfDate: "2026-08-30" });
const amapRequest = createAIAnalysisRequest({ properties: candidates, preferences: amapBuyer, engine: amapEngine, geoEvidenceByProperty: verifiedAmap });
const amapFallback = createDeterministicKnownNarrative(amapRequest.knownDecisionContext);
assert.match(amapFallback.decisionSummary, /32分钟|3个商业体|1家正规医院/);
assert.ok(!/Web Search|高德搜索|搜索过程|当前可用证据/.test(amapFallback.decisionSummary));
assert.equal(validate(amapRequest, amapFallback).success, true);
const commuteNeedSentence = validate(amapRequest, { ...amapFallback, decisionSummary: `${amapFallback.topPropertyName}目前更适合你。预期成交价248万元在300万元预算内，通勤约32分钟，满足你的通勤需求，因此更建议优先考虑。` });
assert.equal(commuteNeedSentence.success, true, `generic commute-need wording must not be misclassified as an unknown space-match conclusion: ${commuteNeedSentence.success ? "" : commuteNeedSentence.errors.join(" | ")}`);
const worseCommuteRequest: AIAnalysisRequest = {
  ...amapRequest,
  context: {
    ...amapRequest.context,
    candidateComparisons: amapRequest.context.candidateComparisons ? {
      ...amapRequest.context.candidateComparisons,
      commute: { ...amapRequest.context.candidateComparisons.commute, relation: "TOP1_WORSE" },
    } : null,
  },
};
const unsupportedCommute = validate(worseCommuteRequest, {
  ...amapFallback,
  decisionSummary: `${amapFallback.topPropertyName}目前更适合你。${amapFallback.topPropertyName}通勤短4分钟，预期成交价在预算内。结合这些条件，建议优先考虑。`,
});
assert.equal(unsupportedCommute.success, false, "'commute is X minutes shorter' must respect authoritative comparison direction");
if (!unsupportedCommute.success) assert.ok(unsupportedCommute.errors.includes("analysis.decisionSummary reverses deterministic commute comparison"));

// D: many null dimensions remain absent from the recommendation.
const sparse = requestFor(["community_quality", "liquidity", "education"]);
const sparseFallback = createDeterministicKnownNarrative(sparse.knownDecisionContext);
const nullCount = sparse.evidencePack.candidates[0].dimensionResults.filter((dimension) => dimension.score === null).length;
assert.ok(nullCount >= 5);
assert.ok(!/(?:缺少|不足以判断|尚待确认|无法判断).*(?:缺少|不足以判断|尚待确认|无法判断)/.test(sparseFallback.decisionSummary));
assert.ok(!/教育|学校|学位|入学/.test(sparseFallback.decisionSummary));

// E: close ranking uses restrained language.
const closeContext = { ...normal.knownDecisionContext, rankingIsClose: true };
const closeFallback = createDeterministicKnownNarrative(closeContext);
assert.ok(!/压倒性|遥遥领先|大幅领先|显著胜出|毫无悬念|明显碾压/.test(closeFallback.decisionSummary));

// G: the active UI has one paragraph and hides old analysis immediately while generating.
const panel = readFileSync("components/ai/ai-analysis-panel.tsx", "utf8");
assert.ok(panel.includes('setState({ status: "loading" })'));
assert.ok(panel.includes('const visibleAnalysis = state.status === "success" ? state.analysis : undefined'));
for (const heading of ["推荐结论</h4>", "关键决策依据", "为什么最终推荐它", "关键取舍</h4>", "还需要注意"]) assert.ok(!panel.includes(heading), `G: active AI report heading removed: ${heading}`);
assert.ok(panel.includes('<p className="rounded-xl bg-[#faf9f6]'));

// H: provider-independent fallback uses the same compact active shape.
assert.deepEqual(Object.keys(normalFallback).sort(), ["decisionSummary", "disclaimer", "pendingEvidence", "topPropertyId", "topPropertyName"].sort());
assert.deepEqual(normalFallback.pendingEvidence, []);
assert.equal(validate(normal, normalFallback).success, true);

const prompt = createAIAnalysisPrompt(normal);
assert.ok(prompt.includes("一个连贯中文自然段"));
assert.ok(prompt.includes("不超过200个中文字符"));
assert.ok(prompt.includes("2–4个"));
assert.ok(prompt.includes("约3个自然完整句子"));
assert.ok(prompt.includes("不要压缩成一句模板"));
assert.ok(prompt.includes("允许根据中文表达自然使用2–4句"));
assert.ok(prompt.includes("不要求分析备选房源"));
assert.ok(!prompt.includes('"decisionFactors"'));
assert.ok(normal.inputSignature.startsWith("aia-v26-"));

console.log(`Preference A: ${communityFirst}`);
console.log(`Preference B: ${budgetFirst}`);
console.log(`Verified AMap: ${amapFallback.decisionSummary}`);
console.log(`Many nulls: ${sparseFallback.decisionSummary}`);
console.log(`No Web: ${normalFallback.decisionSummary}`);

console.log("Final AI home-buying summary tests A-H: PASS");
