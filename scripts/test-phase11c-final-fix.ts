import assert from "node:assert/strict";
import { createAIAnalysisRequest } from "../lib/ai/request";
import { createAIAnalysisPrompt } from "../lib/ai/prompt";
import { validateAIAnalysisResponse, type AINarrativeConsistencyConstraint } from "../lib/ai/validation";
import { runDecisionEngine } from "../lib/decision/engine";
import { buildPropertyDecisionSignals } from "../lib/decision-signals";
import { buildDecisionRisks } from "../lib/decision-presentation";
import { replaceLocalProperties } from "../lib/property-storage";
import type { AIAnalysis, AIAnalysisRequest, AIAnalysisResponse } from "../types/ai-analysis";
import type { BuyerPreferences, DecisionPriority } from "../types/buyer-preferences";
import type { GeoEvidenceByProperty } from "../types/geo-evidence";
import type { Property } from "../types/property";
import type { PropertyWebEvidence, VerifiedEvidenceItem, WebEvidenceByProperty } from "../lib/web-evidence/types";
import { WEB_EVIDENCE_PROVIDER_ID, WEB_EVIDENCE_TARGET_DIMENSIONS, WEB_EVIDENCE_VERSION } from "../lib/web-evidence/types";

const now = "2026-08-29T00:00:00.000Z";

function property(id: string, overrides: Partial<Property> = {}): Property {
  return {
    id, name: `候选${id}`, city: "佛山市", district: "禅城区", address: "测试地址", totalPrice: 250,
    listingPrice: 265, area: 100, layout: "3室2厅2卫", rooms: 3, livingRooms: 2, bathrooms: 2,
    floor: "中楼层", floorLevel: "middle", floorNumber: 10, totalFloors: 30, metroDistance: null,
    schoolInformation: "", propertyManagementInformation: "", propertyCompany: null, propertyFee: null,
    greenRatio: null, parkingRatio: null, propertyManagementExperience: "unknown", publicAreaMaintenance: "unknown",
    communityEnvironmentExperience: "unknown", noiseExperience: "unknown", parkingExperience: "unknown", maintenanceCondition: "unknown",
    propertyExperience: null, environment: null, noise: null, parking: null, publicArea: null,
    actualCommuteExperience: null, recentDealPrice: null, comparableTransactions: [], deliveryYear: 2020,
    orientation: "south", status: "completed", source: "manual", createdAt: now, updatedAt: now, ...overrides,
  };
}

function preferences(topPriorities: DecisionPriority[]): BuyerPreferences {
  return {
    id: "preferences", purchasePurpose: "self_use", maximumBudget: 300, primaryWorkLocation: "工作地点", partnerWorkLocation: null,
    commuteMode: "driving", idealCommuteMinutes: 35, maxCommuteMinutes: 50, primaryCommuteMode: "driving",
    primaryIdealCommuteMinutes: 35, primaryMaxCommuteMinutes: 50, educationNeed: "none", educationStages: [],
    topPriorities, createdAt: now, updatedAt: now,
  };
}

function geo(properties: Property[]): GeoEvidenceByProperty {
  return Object.fromEntries(properties.map((item, index) => [item.id, {
    commute: {
      dimension: "commute", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "路线证据",
      primary: { destinationLabel: "工作地点", requestedMode: "driving", modeResults: { driving: { minutes: index === 0 ? 42 : 28, distanceMeters: 20000 } }, selectedMode: "driving", selectedMinutes: index === 0 ? 42 : 28, status: "verified", quality: "high", fetchedAt: now },
    },
    commercial_amenities: { dimension: "commercial_amenities", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "商业证据", countWithin2000m: index === 0 ? 4 : 2, nearestDistanceMeters: index === 0 ? 600 : 1200, examples: ["商业体"] },
  }])) as unknown as GeoEvidenceByProperty;
}

function webConflict(propertyId: string): PropertyWebEvidence {
  const item: VerifiedEvidenceItem = {
    propertyId, dimension: "property_management", key: "property_fee", value: 3.2, normalizedValue: 3.2,
    unit: "元/㎡/月", evidenceKind: "contextual", sourceType: "web", sourceTitle: "官方项目资料",
    sourceUrl: "https://example.gov.cn/property", sourceDomain: "example.gov.cn", retrievedAt: now,
    confidence: "high", corroborationCount: 1, status: "verified",
    sources: [{ sourceType: "web", sourceTitle: "官方项目资料", sourceUrl: "https://example.gov.cn/property", sourceDomain: "example.gov.cn", retrievedAt: now, tier: "A" }],
  };
  return {
    propertyId, propertyIdentitySignature: `identity-${propertyId}`, fetchedAt: now, version: WEB_EVIDENCE_VERSION, providerId: WEB_EVIDENCE_PROVIDER_ID,
    dimensions: WEB_EVIDENCE_TARGET_DIMENSIONS.map((dimensionKey) => ({
      dimensionKey, status: dimensionKey === "property_management" ? "verified" : "unavailable",
      summary: dimensionKey === "property_management" ? "公开资料包含物业费信息。" : "当前缺少足够公开证据。",
      facts: [], verifiedEvidence: dimensionKey === "property_management" ? [item] : [],
    })),
  };
}

function request(properties: Property[], prefs: BuyerPreferences, web: WebEvidenceByProperty = {}): AIAnalysisRequest {
  const geoEvidenceByProperty = geo(properties);
  const engine = runDecisionEngine({ properties, preferences: prefs, asOfDate: "2026-08-29", geoEvidenceByProperty, webEvidenceByProperty: web });
  return createAIAnalysisRequest({ properties, preferences: prefs, engine, geoEvidenceByProperty, webEvidenceByProperty: web });
}

function safeAnalysis(input: AIAnalysisRequest): AIAnalysisResponse {
  const top = input.evidencePack.candidates[0].property;
  const alternative = input.evidencePack.candidates[1].property;
  const label: Record<DecisionPriority, string> = {
    commute: "通勤", price: "预算", layout_and_space: "户型与空间", community_quality: "小区品质",
    property_management: "物业服务", education: "教育", commercial_amenities: "商业配套", medical_amenities: "医疗配套",
    public_transport: "公共交通", liquidity: "流动性", value_preservation: "长期价值",
  };
  const priorityAnalysis = input.effectivePriorities.map((priority) => ({ priority, analysis: `${label[priority]}方面，当前证据用于比较的边界仍以已记录事实和确定性结果为准。` }));
  const analysis: AIAnalysis = {
    topPropertyId: top.id, topPropertyName: top.name,
    decisionSummary: `${top.name}保持当前首选；${input.effectivePriorities.map((priority) => label[priority]).join("、")}均已结合现有证据分析。与${alternative.name}相比，当前结论承认备选可在单项指标上更强，但不改变权威排序。`,
    topPriorityAnalysis: priorityAnalysis,
    tradeoff: `与${alternative.name}相比，当前取舍以已有维度结果和证据边界为准。`,
    additionalInsight: [], risksOrUnknowns: ["尚未形成充分证据的事项仍需确认。"],
    pendingEvidence: [],
    disclaimer: "本解读基于当前已知信息与房源比较结果，不替代实地核验和专业意见。",
  };
  return { ok: true, analysis, metadata: { generatedAt: now, inputSignature: input.inputSignature, provider: "zhipu", model: "test" } };
}

function consistency(input: AIAnalysisRequest): AINarrativeConsistencyConstraint {
  return {
    educationNeed: input.context.preferences.educationNeed,
    comparisons: input.context.candidateComparisons,
    topPropertyName: input.context.candidates[0].property.name ?? undefined,
    dimensions: input.context.candidates[0].decision.dimensions.map(({ key, label, score, status }) => ({ key, label, score, status })),
    evidencePack: input.evidencePack,
    effectivePriorities: input.effectivePriorities,
    requireEvidenceGroundedStructure: true,
  };
}

function validate(input: AIAnalysisRequest, response: AIAnalysisResponse) {
  return validateAIAnalysisResponse(
    response,
    input.context.authoritativeTopPropertyId,
    input.context.candidates[0].property.name ?? undefined,
    [input.context.candidates[1].property.name!],
    false,
    consistency(input),
  );
}

const properties = [
  property("a", { totalPrice: 238, area: 112, propertyFee: 2.7, greenRatio: 32, parkingRatio: 1.1, propertyManagementExperience: "good", publicAreaMaintenance: "good", communityEnvironmentExperience: "very_good", noiseExperience: "low", parkingExperience: "average", maintenanceCondition: "good" }),
  property("b", { totalPrice: 270, area: 128, propertyFee: 2.5, greenRatio: 25, parkingRatio: 0.8, propertyManagementExperience: "average", publicAreaMaintenance: "average", communityEnvironmentExperience: "average", noiseExperience: "minimal", parkingExperience: "good", maintenanceCondition: "average" }),
];
const configurations = [
  preferences(["community_quality", "commute", "commercial_amenities"]),
  preferences(["price", "layout_and_space", "commute"]),
  preferences(["property_management", "liquidity", "value_preservation"]),
];
const requests = configurations.map((prefs) => request(properties, prefs));

assert.ok(requests.every((item, index) => item.effectivePriorities.every((priority) => configurations[index].topPriorities.includes(priority))), "A/C: usable priorities must remain a subset of the current Top3");
assert.equal(new Set(requests.map((item) => JSON.stringify(item.evidencePack.intendedWeights))).size, 3, "B: dynamic Top3 must produce distinct intended weights");
assert.ok(requests.every((item) => item.evidencePack.candidates.every((candidate) => candidate.decisionSignals.length > 0)), "D/E: structured subjective and objective supplemental edits must reach the pack");
assert.ok(createAIAnalysisPrompt(requests[0]).includes('"key":"green_ratio"') && createAIAnalysisPrompt(requests[0]).includes('"key":"property_management_experience"'), "G/H: changed structured facts and signals must reach the closed-world GLM context");

const structuredChanged = request([{ ...properties[0], propertyManagementExperience: "very_good" }, properties[1]], configurations[0]);
const objectiveChanged = request([{ ...properties[0], greenRatio: 40 }, properties[1]], configurations[0]);
assert.notEqual(structuredChanged.inputSignature, requests[0].inputSignature, "F/Z: structured edits must invalidate AI signature");
assert.notEqual(objectiveChanged.inputSignature, requests[0].inputSignature, "F/Z: objective edits must invalidate AI signature");
const cosmeticChanged = request([{ ...properties[0], imageUrl: "https://example.com/new.jpg", updatedAt: "2026-09-01T00:00:00.000Z", status: "pending_analysis" }, properties[1]], configurations[0]);
assert.equal(cosmeticChanged.inputSignature, requests[0].inputSignature, "AB: cosmetic/workflow changes must not invalidate AI analysis");

const topOverride = safeAnalysis(requests[0]) as Extract<AIAnalysisResponse, { ok: true }>;
topOverride.analysis.topPropertyId = requests[0].evidencePack.candidates[1].property.id;
assert.equal(validateAIAnalysisResponse(topOverride, requests[0].context.authoritativeTopPropertyId).success, false, "I: AI cannot override Top1");

const unknownSignals = buildPropertyDecisionSignals(property("unknown", { propertyExperience: "服务似乎不错，但来源不确定" }));
assert.ok(unknownSignals.filter((item) => item.role === "supporting").every((item) => item.status === "unknown"), "J/K/Y: missing structured input and legacy free text remain neutral");
assert.ok(unknownSignals.find((item) => item.key === "property_experience_note")?.role === "contextual", "X/Y: legacy free text remains loadable contextual data");
assert.ok(requests[0].evidencePack.candidates.some((candidate) => candidate.property.area === 128), "L: non-Top3 objective advantages remain available");
assert.ok(requests[0].evidencePack.signalComparisons.some((item) => item.relation === "top_weaker" || item.relation === "top_lower"), "M: alternative may win individual signals");
assert.ok(requests[0].evidencePack.signalComparisons.find((item) => item.key === "green_ratio")?.interpretationBoundary.includes("不能证明"), "O: objective numeric differences retain a non-judgment boundary");

const baseEngine = runDecisionEngine({ properties, preferences: configurations[0], asOfDate: "2026-08-29", geoEvidenceByProperty: geo(properties) });
const noObjectiveSupplemental = properties.map((item) => ({ ...item, propertyFee: null, greenRatio: null, parkingRatio: null }));
const noObjectiveSupplementalEngine = runDecisionEngine({ properties: noObjectiveSupplemental, preferences: configurations[0], asOfDate: "2026-08-29", geoEvidenceByProperty: geo(noObjectiveSupplemental) });
assert.deepEqual(baseEngine.results.map((result) => result.dimensions.map((dimension) => dimension.score)), noObjectiveSupplementalEngine.results.map((result) => result.dimensions.map((dimension) => dimension.score)), "N/T: objective explanatory signals must not change or double-count deterministic scores");

const conflicted = request(properties, configurations[0], { a: webConflict("a") });
const feeSignal = conflicted.evidencePack.candidates.find((candidate) => candidate.property.id === "a")?.decisionSignals.find((item) => item.key === "property_fee");
assert.equal(feeSignal?.status, "conflicting", "V/W: user/web numeric conflict must be retained");
assert.equal(feeSignal?.value, 2.7, "W: user value must not be overwritten or averaged");
assert.deepEqual(feeSignal?.externalValues?.map((item) => item.value), [3.2], "V/W: external provenance and value must remain separate");
assert.equal(requests[0].evidencePack.candidates[0].decisionSignals.find((item) => item.key === "property_management_experience")?.source, "user_reported", "U: structured subjective provenance must remain user-reported");
const baselineNarrative = safeAnalysis(requests[0]);
assert.equal(validate(requests[0], baselineNarrative).success, true, "AE: factually safe wording variation must pass full validation");
const ungroundedSubjective = structuredClone(baselineNarrative) as Extract<AIAnalysisResponse, { ok: true }>;
ungroundedSubjective.analysis.additionalInsight = ["物业服务体验较好，因此构成明确优势。"];
assert.equal(validate(requests[0], ungroundedSubjective).success, false, "U: user-reported subjective observations require explicit provenance when used positively");
const groundedSubjective = structuredClone(baselineNarrative) as Extract<AIAnalysisResponse, { ok: true }>;
groundedSubjective.analysis.additionalInsight = ["根据你记录的现场观察，物业服务体验较好，但这只是支持信号，不能单独决定物业服务结论。"];
const groundedValidation = validate(requests[0], groundedSubjective);
assert.equal(groundedValidation.success, true, `U/AE: provenance-aware cautious wording must pass validation: ${groundedValidation.success ? "" : groundedValidation.errors.join(" | ")}`);
const conflictClaim = safeAnalysis(conflicted) as Extract<AIAnalysisResponse, { ok: true }>;
conflictClaim.analysis.additionalInsight = ["物业费更有优势。"];
assert.equal(validate(conflicted, conflictClaim).success, false, "Q/V/W: a conflicting source value cannot support a winner claim");

const presentationEngine = runDecisionEngine({ properties, preferences: configurations[0], asOfDate: "2026-08-29", geoEvidenceByProperty: geo(properties) });
const presentationTop = properties.find((item) => item.id === presentationEngine.ranking[0])!;
const presentationRisks = buildDecisionRisks({
  property: presentationTop,
  result: presentationEngine.results[0],
  preferences: configurations[0],
  geoEvidenceByProperty: geo(properties),
  webEvidenceByProperty: {},
});
assert.ok(
  presentationRisks.some((item) => item.title === "小区实际品质" && /仍缺少|尚不足/.test(item.description)),
  "S: a user-reported supporting signal must not suppress an unknown high-level community-quality evidence gap",
);

const originalWindow = (globalThis as unknown as { window?: unknown }).window;
const values = new Map<string, string>();
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear(), key: () => null, get length() { return values.size; } } } });
try {
  const legacy = replaceLocalProperties([{ ...property("legacy"), propertyExperience: "很好", environment: "绿化不错", propertyManagementExperience: undefined }]);
  assert.equal(legacy[0].propertyManagementExperience, "unknown", "X/Y: legacy text must not be guessed into a category");
  assert.equal(legacy[0].propertyExperience, "很好", "X: legacy note must be preserved");
} finally {
  if (originalWindow === undefined) delete (globalThis as unknown as { window?: unknown }).window;
  else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
}

assert.ok(requests.every((item) => !item.effectivePriorities.includes("education")), "AC: education none remains excluded");
assert.ok(requests.every((item) => safeAnalysis(item).ok), "S/AE: generalized factual wording remains frontend-compatible");

console.log("Phase 11C Final Fix deterministic tests A-AE: PASS");
console.log("Phase 11C Final Fix configurations:", JSON.stringify(requests.map((item) => ({ priorities: item.effectivePriorities, ranking: item.evidencePack.ranking, top1: item.evidencePack.candidates[0].property.name }))));
