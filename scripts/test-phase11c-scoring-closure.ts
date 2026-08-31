import assert from "node:assert/strict";
import { createAIAnalysisRequest } from "../lib/ai/request";
import {
  blendUserObservationScore,
  buildPropertyDecisionSignals,
  buildUserObservationScoreSummary,
  normalizeStructuredObservation,
} from "../lib/decision-signals";
import { runDecisionEngine } from "../lib/decision/engine";
import type { BuyerPreferences, DecisionPriority } from "../types/buyer-preferences";
import type { DecisionEngineResult, DimensionKey, PropertyDecisionResult } from "../types/decision";
import type { Property } from "../types/property";

const now = "2026-08-30T00:00:00.000Z";

function property(id: string, overrides: Partial<Property> = {}): Property {
  return {
    id,
    name: `候选${id}`,
    city: "测试市",
    district: "测试区",
    address: "测试地址",
    totalPrice: 250,
    listingPrice: 265,
    area: 100,
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

function preferences(topPriorities: DecisionPriority[]): BuyerPreferences {
  return {
    id: "preferences",
    purchasePurpose: "self_use",
    maximumBudget: 300,
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

const communityHigh = preferences(["community_quality", "commute", "commercial_amenities"]);
const communityLow = preferences(["price", "layout_and_space", "commute"]);
const managementHigh = preferences(["property_management", "liquidity", "value_preservation"]);

function engine(properties: Property[], buyer = communityHigh): DecisionEngineResult {
  return runDecisionEngine({ properties, preferences: buyer, asOfDate: "2026-08-30" });
}

function resultById(result: DecisionEngineResult, id: string): PropertyDecisionResult {
  return result.results.find((item) => item.propertyId === id)!;
}

function score(result: DecisionEngineResult, id: string, key: DimensionKey): number | null {
  return resultById(result, id).dimensions.find((item) => item.key === key)?.score ?? null;
}

function allScores(result: DecisionEngineResult, id: string): Array<number | null> {
  return resultById(result, id).dimensions.map((item) => item.score);
}

const unknownExplicit = [property("a"), property("b")];
const unknownMissing = unknownExplicit.map((item) => ({
  ...item,
  propertyManagementExperience: undefined,
  publicAreaMaintenance: undefined,
  communityEnvironmentExperience: undefined,
  noiseExperience: undefined,
  parkingExperience: undefined,
  maintenanceCondition: undefined,
}));
const explicitBaseline = engine(unknownExplicit);
const missingBaseline = engine(unknownMissing);
assert.deepEqual(explicitBaseline.results.map((item) => ({ id: item.propertyId, score: item.overallScore, recommendation: item.recommendation, dimensions: item.dimensions.map((dimension) => dimension.score) })), missingBaseline.results.map((item) => ({ id: item.propertyId, score: item.overallScore, recommendation: item.recommendation, dimensions: item.dimensions.map((dimension) => dimension.score) })), "A: unknown/missing observations must preserve the pre-closure scoring behavior");
assert.deepEqual(explicitBaseline.ranking, missingBaseline.ranking, "A: unknown/missing observations must preserve ranking");

const poorCommunity = property("a", { publicAreaMaintenance: "very_poor", communityEnvironmentExperience: "very_poor", noiseExperience: "severe", maintenanceCondition: "very_poor" });
const strongCommunity = property("b", { publicAreaMaintenance: "very_good", communityEnvironmentExperience: "very_good", noiseExperience: "minimal", maintenanceCondition: "very_good" });
const communityDirection = engine([poorCommunity, strongCommunity]);
assert.ok((score(communityDirection, "b", "community_quality") ?? 0) > (score(communityDirection, "a", "community_quality") ?? 100), "B: stronger eligible observations must produce the higher community-quality score");

const weakManagement = property("a", { propertyManagementExperience: "poor" });
const strongManagement = property("b", { propertyManagementExperience: "very_good" });
const managementDirection = engine([weakManagement, strongManagement], managementHigh);
assert.ok((score(managementDirection, "b", "property_management") ?? 0) > (score(managementDirection, "a", "property_management") ?? 100), "C: stronger property-management observation must produce the higher owned score");

const unknownManagement = engine([property("a", { propertyManagementExperience: "good" }), property("b")], managementHigh);
assert.equal(score(unknownManagement, "b", "property_management"), null, "D: unknown must remain unscored rather than becoming zero or average");

const observedCommunityResult = resultById(communityDirection, "b").dimensions.find((item) => item.key === "community_quality")!;
assert.equal(observedCommunityResult.status, "partial", "E: observation-only dimension must remain partial");
assert.ok(observedCommunityResult.evidence.some((item) => item.source === "user_reported" && /50 分中性先验/.test(item.description) && /不代表实际表现为一般/.test(item.description)), "E: neutral prior must be exposed as mathematical only and provenance must remain user-reported");

const oneSignalBase = engine([property("a"), property("b", { publicAreaMaintenance: "very_good" })]);
const changedDimensions = resultById(oneSignalBase, "b").dimensions.filter((item, index) => item.score !== resultById(explicitBaseline, "b").dimensions[index].score).map((item) => item.key);
assert.deepEqual(changedDimensions, ["community_quality"], "F: one raw observation must affect only its single scoring owner");

const sameObservedProperties = [poorCommunity, strongCommunity];
const highWeight = engine(sameObservedProperties, communityHigh);
const lowWeight = engine(sameObservedProperties, communityLow);
const highDimensionGap = Math.abs((score(highWeight, "b", "community_quality") ?? 0) - (score(highWeight, "a", "community_quality") ?? 0));
const lowDimensionGap = Math.abs((score(lowWeight, "b", "community_quality") ?? 0) - (score(lowWeight, "a", "community_quality") ?? 0));
const highOverallGap = Math.abs((resultById(highWeight, "b").overallScore ?? 0) - (resultById(highWeight, "a").overallScore ?? 0));
const lowOverallGap = Math.abs((resultById(lowWeight, "b").overallScore ?? 0) - (resultById(lowWeight, "a").overallScore ?? 0));
assert.equal(highDimensionGap, lowDimensionGap, "G: Top3 must not modify raw dimension signal difference");
assert.ok(highOverallGap > lowOverallGap, "G: existing normalized weights must create the larger overall impact when the dimension is prioritized");

const flipProperties = [
  property("a", { totalPrice: 250, deliveryYear: 2025, publicAreaMaintenance: "very_poor", communityEnvironmentExperience: "very_poor", noiseExperience: "severe", maintenanceCondition: "very_poor" }),
  property("b", { totalPrice: 295, deliveryYear: 2010, publicAreaMaintenance: "very_good", communityEnvironmentExperience: "very_good", noiseExperience: "minimal", maintenanceCondition: "very_good" }),
];
const highPriorityFlip = engine(flipProperties, communityHigh);
const lowPriorityNoFlip = engine(flipProperties, communityLow);
assert.equal(highPriorityFlip.ranking[0], "b", "H: high existing community-quality weight must allow a justified deterministic ranking flip");
assert.equal(lowPriorityNoFlip.ranking[0], "a", "I: low target-dimension weight must not force the same ranking flip");

const objectiveBase = property("objective");
for (const [field, value, ownedDimension] of [
  ["propertyFee", 8.8, "property_management"],
  ["greenRatio", 55, "community_quality"],
  ["parkingRatio", 2, "community_quality"],
] as const) {
  const before = engine([objectiveBase]);
  const after = engine([{ ...objectiveBase, [field]: value }]);
  assert.deepEqual(allScores(after, "objective"), allScores(before, "objective"), `${field}: objective supporting fact must remain non-scoring`);
  assert.equal(score(after, "objective", ownedDimension), score(before, "objective", ownedDimension));
}

const legacyBefore = engine([property("legacy")]);
const legacyAfter = engine([property("legacy", { propertyExperience: "非常好", environment: "绿化不错", noise: "安静", parking: "方便", publicArea: "维护很好" })]);
assert.deepEqual(allScores(legacyAfter, "legacy"), allScores(legacyBefore, "legacy"), "M: legacy free text must remain contextual and non-scoring");

const scoredSignals = buildPropertyDecisionSignals(strongCommunity).filter((item) => item.role === "deterministic_scoring_input" && item.status === "available");
assert.ok(scoredSignals.length === 4 && scoredSignals.every((item) => item.source === "user_reported" && item.scoringOwner === "community_quality"), "N: scored observations must retain user-reported provenance and one owner");
assert.equal(buildPropertyDecisionSignals(property("parking", { parkingExperience: "very_good" })).find((item) => item.key === "parking_experience")?.scoringOwner, null, "N: parking experience has no defensible scoring owner in the current registry");

const averageSummary = buildUserObservationScoreSummary(property("mean", { publicAreaMaintenance: "good", communityEnvironmentExperience: "unknown", noiseExperience: "minimal" }), "community_quality")!;
assert.equal(averageSummary.knownCount, 2, "O: unknown values must be excluded from the observation mean");
assert.equal(averageSummary.normalizedScore, 0.875, "O: known values must use an equal arithmetic mean");
assert.equal(buildUserObservationScoreSummary(property("one", { publicAreaMaintenance: "very_good" }), "community_quality")?.observationWeight, 0.15, "P: one known signal must use 15% weight");
assert.equal(averageSummary.observationWeight, 0.25, "P: two or more known signals must use 25% weight");
assert.equal(blendUserObservationScore(60, averageSummary).finalScore, 67, "P: base score integration must use the bounded formula on the native 0-100 scale");
assert.equal(blendUserObservationScore(null, buildUserObservationScoreSummary(property("neutral", { publicAreaMaintenance: "very_good" }), "community_quality")!).finalScore, 58, "E/P: one very-good observation on unknown base must use the neutral prior and 15% cap");
assert.equal(normalizeStructuredObservation("unknown"), null, "D/O: unknown has no normalized value");

const request = createAIAnalysisRequest({ properties: sameObservedProperties, preferences: communityHigh, engine: highWeight });
const changedRequestProperties = [{ ...poorCommunity, publicAreaMaintenance: "average" as const }, strongCommunity];
const changedRequestEngine = engine(changedRequestProperties, communityHigh);
const changedRequest = createAIAnalysisRequest({ properties: changedRequestProperties, preferences: communityHigh, engine: changedRequestEngine });
assert.ok(request.inputSignature.startsWith("aia-v26-") && !request.inputSignature.startsWith("aia-v25-"), "Q: final grounded interpretation must invalidate aia-v25 cache once");
assert.notEqual(request.inputSignature, changedRequest.inputSignature, "Q: regenerated context must receive a new signature after a scored observation changes");
assert.equal(request.evidencePack.candidates[0].decisionSignals.some((item) => item.role === "deterministic_scoring_input"), true, "Q: AI Evidence Pack must receive scored signals");
assert.equal(request.evidencePack.topCandidate.propertyId, highWeight.ranking[0], "Q: AI receives the updated authoritative ranking");
assert.equal(highWeight.engineVersion, "decision-engine-v2.3", "Q: comparable-ranking semantic version must advance");

const configurations = [communityHigh, communityLow, managementHigh];
const configurationResults = configurations.map((buyer) => engine(sameObservedProperties, buyer));
assert.equal(new Set(configurationResults.map((item) => JSON.stringify(item.intendedWeights))).size, 3, "generalization: three preference configurations must produce distinct intended weights");
assert.ok(configurationResults.every((item) => score(item, "a", "community_quality") === score(configurationResults[0], "a", "community_quality")), "generalization: dimension signal values must remain preference-independent");

console.log("Phase 11C Scoring Closure synthetic tests A-Q: PASS");
console.log("Scoring Closure representative:", JSON.stringify({
  communityScores: { weak: score(communityDirection, "a", "community_quality"), strong: score(communityDirection, "b", "community_quality") },
  managementScores: { weak: score(managementDirection, "a", "property_management"), strong: score(managementDirection, "b", "property_management") },
  highPriorityRanking: highPriorityFlip.ranking,
  lowPriorityRanking: lowPriorityNoFlip.ranking,
  highOverallGap,
  lowOverallGap,
}));
