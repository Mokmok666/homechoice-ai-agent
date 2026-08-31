import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAIAnalysisRequest } from "../lib/ai/request";
import { createDeterministicKnownNarrative } from "../lib/ai/deterministic-narrative";
import { runDecisionEngine } from "../lib/decision/engine";
import { calculateWeights, INVESTMENT_BASE_PRIORS, SELF_USE_BASE_PRIORS, TOP_PRIORITY_GROUP_SHARES } from "../lib/decision/weights";
import { DIMENSION_KEYS, type DecisionEngineResult, type DimensionKey } from "../types/decision";
import type { BuyerPreferences, DecisionPriority } from "../types/buyer-preferences";
import type { Property } from "../types/property";

const now = "2026-08-30T00:00:00.000Z";

function property(id: string, overrides: Partial<Property> = {}): Property {
  return {
    id, name: `候选${id}`, city: "佛山市", district: "禅城区", address: `${id}路1号`, totalPrice: 250,
    listingPrice: 265, area: 100, layout: "3室2厅2卫", rooms: 3, livingRooms: 2, bathrooms: 2,
    floor: "中楼层", floorLevel: "middle", floorNumber: 10, totalFloors: 30, metroDistance: null,
    schoolInformation: "", propertyManagementInformation: "", propertyCompany: null, propertyFee: null,
    greenRatio: null, parkingRatio: null, propertyManagementExperience: "unknown", publicAreaMaintenance: "unknown",
    communityEnvironmentExperience: "unknown", noiseExperience: "unknown", parkingExperience: "unknown",
    maintenanceCondition: "unknown", propertyExperience: null, environment: null, noise: null, parking: null,
    publicArea: null, actualCommuteExperience: null, recentDealPrice: null, comparableTransactions: [],
    deliveryYear: 2020, orientation: "south", status: "completed", source: "manual", createdAt: now, updatedAt: now,
    ...overrides,
  };
}

function preferences(topPriorities: DecisionPriority[] = ["community_quality", "price", "layout_and_space"]): BuyerPreferences {
  return {
    id: "preferences", purchasePurpose: "self_use", maximumBudget: 300, primaryWorkLocation: "", partnerWorkLocation: null,
    commuteMode: "not_important", idealCommuteMinutes: null, maxCommuteMinutes: null, primaryCommuteMode: "not_important",
    primaryIdealCommuteMinutes: null, primaryMaxCommuteMinutes: null, educationNeed: "none", educationStages: [],
    topPriorities, createdAt: now, updatedAt: now,
  };
}

function run(properties: Property[], buyer = preferences()): DecisionEngineResult {
  return runDecisionEngine({ properties, preferences: buyer, asOfDate: "2026-08-30" });
}

function dimension(engine: DecisionEngineResult, propertyId: string, key: DimensionKey) {
  return engine.results.find((item) => item.propertyId === propertyId)!.dimensions.find((item) => item.key === key)!;
}

assert.equal(Object.values(SELF_USE_BASE_PRIORS).reduce((sum, value) => sum + value, 0), 100, "self-use priors sum to 100");
assert.equal(Object.values(INVESTMENT_BASE_PRIORS).reduce((sum, value) => sum + value, 0), 100, "investment priors sum to 100");
assert.deepEqual(TOP_PRIORITY_GROUP_SHARES, [18, 14, 11], "Top3 group shares are final calibration");
const grouped = calculateWeights("self_use", ["layout_and_space", "price", "commute"]);
assert.ok(Math.abs(grouped.layout_design + grouped.space_match - 18) < 0.0001, "multi-dimension preference receives one group share");

// Null for both: excluded, neither penalty nor reward.
const bothUnknown = run([property("a"), property("b")]);
assert.equal(dimension(bothUnknown, "a", "community_quality").score, null);
assert.equal(dimension(bothUnknown, "b", "community_quality").score, null);
assert.equal(dimension(bothUnknown, "a", "community_quality").finalWeight, 0);
assert.ok(!bothUnknown.effectiveComparableDimensions?.includes("community_quality"));

// Partial candidate coverage: excluded for everybody.
const partialCoverage = run([property("a", { communityEnvironmentExperience: "very_good" }), property("b")]);
assert.notEqual(dimension(partialCoverage, "a", "community_quality").score, null);
assert.equal(dimension(partialCoverage, "b", "community_quality").score, null);
assert.equal(dimension(partialCoverage, "a", "community_quality").finalWeight, 0);
assert.equal(dimension(partialCoverage, "b", "community_quality").finalWeight, 0);

// Full comparable coverage: included with one shared vector.
const fullCoverage = run([
  property("a", { communityEnvironmentExperience: "poor" }),
  property("b", { communityEnvironmentExperience: "very_good" }),
]);
assert.ok(fullCoverage.effectiveComparableDimensions?.includes("community_quality"));
assert.ok(dimension(fullCoverage, "a", "community_quality").finalWeight > 0);
for (const key of DIMENSION_KEYS) {
  assert.equal(dimension(fullCoverage, "a", key).finalWeight, dimension(fullCoverage, "b", key).finalWeight, `shared weight: ${key}`);
}
assert.ok(Math.abs(Object.values(fullCoverage.weights).reduce((sum, value) => sum + value, 0) - 100) < 0.0001);
assert.deepEqual(fullCoverage.intendedWeights, calculateWeights("self_use", preferences().topPriorities, "none"));
assert.equal(fullCoverage.intendedWeights?.education, 0);

// Known context excludes unknown dimensions but preserves original preference.
const unknownRequest = createAIAnalysisRequest({ properties: [property("a"), property("b")], preferences: preferences(), engine: bothUnknown });
assert.deepEqual(unknownRequest.knownDecisionContext.buyer.originalTop3, preferences().topPriorities);
assert.ok(!unknownRequest.knownDecisionContext.effectiveComparableDimensions.includes("community_quality"));
assert.ok(unknownRequest.knownDecisionContext.candidates.every((candidate) => candidate.comparableDimensions.every((item) => item.score !== null)));
assert.ok(!unknownRequest.knownDecisionContext.decisiveKnownFactors.some((item) => item.dimension === "community_quality"));
assert.ok(unknownRequest.inputSignature.startsWith("aia-v26-"));
assert.equal(unknownRequest.context.decisionVersion, "decision-engine-v2.3");

const fallback = createDeterministicKnownNarrative(unknownRequest.knownDecisionContext);
assert.equal(fallback.topPropertyId, bothUnknown.ranking[0]);
assert.match(fallback.decisionSummary, /更适合你|建议优先考虑/);
assert.ok(!/基于你当前的购房偏好和现有可确认信息|当前权威排序|整体匹配/.test(fallback.decisionSummary));
assert.ok(!/UNKNOWN|Evidence Gap|Decision Engine|community_quality/.test(JSON.stringify(fallback)));
assert.ok((fallback.attentionItems?.length ?? 0) <= 2);
if (bothUnknown.ranking.length > 1) assert.ok(JSON.stringify(fallback).includes(property("b").name) || JSON.stringify(fallback).includes(property("a").name));

// Material attention only: no exhaustive unknown checklist, and hard blockers remain visible.
const fullyObservedProperties = [
  property("a", { communityEnvironmentExperience: "good", propertyManagementExperience: "good" }),
  property("b", { communityEnvironmentExperience: "very_good", propertyManagementExperience: "very_good" }),
];
const fullyObservedPreferences = preferences(["community_quality", "property_management", "price"]);
const fullyObservedRequest = createAIAnalysisRequest({ properties: fullyObservedProperties, preferences: fullyObservedPreferences, engine: run(fullyObservedProperties, fullyObservedPreferences) });
assert.equal(fullyObservedRequest.knownDecisionContext.attentionCandidates.length, 0, "no material uncertainty means no attention section");
assert.ok(unknownRequest.knownDecisionContext.attentionCandidates.some((item) => item.dimension === "community_quality"), "material unavailable Top1 preference becomes concise attention");
assert.ok(!unknownRequest.knownDecisionContext.attentionCandidates.some((item) => item.dimension === "liquidity"), "irrelevant non-Top3 unknown is hidden");
const blockedProperty = property("blocked", { totalPrice: 350 });
const blockedEngine = run([blockedProperty]);
const blockedRequest = createAIAnalysisRequest({ properties: [blockedProperty], preferences: preferences(), engine: blockedEngine });
assert.ok(blockedRequest.knownDecisionContext.attentionCandidates.some((item) => item.kind === "hard_constraint"), "hard blocker remains an attention item");

// Preference changes alter intended emphasis without mutating raw dimension scores.
const configurations: DecisionPriority[][] = [
  ["community_quality", "price", "layout_and_space"],
  ["price", "layout_and_space", "community_quality"],
  ["property_management", "price", "community_quality"],
];
const configured = configurations.map((priorities) => run([
  property("a", { communityEnvironmentExperience: "poor", propertyManagementExperience: "poor" }),
  property("b", { communityEnvironmentExperience: "very_good", propertyManagementExperience: "very_good" }),
], preferences(priorities)));
assert.equal(new Set(configured.map((item) => JSON.stringify(item.intendedWeights))).size, 3);
assert.equal(new Set(configured.map((item) => dimension(item, "a", "community_quality").score)).size, 1, "preference changes must not change raw dimension scores");

// UI closure: legacy values remain in state/storage, but subjective editors are gone.
const propertyForm = readFileSync("components/property/property-form.tsx", "utf8");
for (const label of ["物业服务补充说明", "小区环境补充说明", "噪音补充说明", "停车补充说明", "公共区域补充说明", "实际通勤体验"]) assert.ok(!propertyForm.includes(label), `removed subjective editor: ${label}`);
for (const field of ["propertyManagementExperience", "publicAreaMaintenance", "communityEnvironmentExperience", "noiseExperience", "parkingExperience", "maintenanceCondition"]) assert.ok(propertyForm.includes(field), `structured field remains: ${field}`);
assert.ok(propertyForm.includes("comparableTransactions"));

const resultsUi = readFileSync("components/decision/decision-results.tsx", "utf8");
assert.ok(!resultsUi.includes("买之前还需要确认"));
const aiPanel = readFileSync("components/ai/ai-analysis-panel.tsx", "utf8");
assert.ok(aiPanel.includes('setState({ status: "loading" })'));
assert.ok(!aiPanel.includes("正在更新解读，当前仍显示上一次有效结果"));
assert.ok(aiPanel.includes("房源或偏好已变化，请重新生成AI解读"));

console.log("Final Decision Synthesis deterministic tests: PASS");
