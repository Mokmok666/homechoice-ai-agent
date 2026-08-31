import assert from "node:assert/strict";
import type { BuyerPreferences, DecisionPriority } from "../types/buyer-preferences";
import type { Property } from "../types/property";
import { DIMENSION_KEYS, type DimensionKey } from "../types/decision";
import type { GeoEvidenceByProperty } from "../types/geo-evidence";
import { BASE_WEIGHTS } from "../lib/decision/dimensions";
import { runDecisionEngine } from "../lib/decision/engine";
import {
  calculateBudgetMatchScore,
  scoreTransactionPriceReasonableness,
} from "../lib/decision/scorers";
import { calculateWeights, getPriorityDimensions } from "../lib/decision/weights";

const now = "2026-08-28T00:00:00.000Z";

function property(id: string, totalPrice: number, area = 100): Property {
  return {
    id,
    name: `房源${id}`,
    city: "佛山市",
    district: "禅城区",
    address: "测试地址",
    totalPrice,
    area,
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
    comparableTransactions: [],
    deliveryYear: 2022,
    orientation: "south",
    status: "completed",
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}

function preferences(
  topPriorities: DecisionPriority[] = ["price", "community_quality", "education"],
): BuyerPreferences {
  return {
    id: "preferences-test",
    purchasePurpose: "self_use",
    maximumBudget: 300,
    primaryWorkLocation: "",
    partnerWorkLocation: null,
    commuteMode: "not_important",
    idealCommuteMinutes: null,
    maxCommuteMinutes: null,
    educationNeed: "none",
    educationStages: [],
    topPriorities,
    createdAt: now,
    updatedAt: now,
  };
}

function resultFor(properties: Property[], prefs = preferences(), geoEvidenceByProperty?: GeoEvidenceByProperty) {
  return runDecisionEngine({ properties, preferences: prefs, asOfDate: "2026-08-28", geoEvidenceByProperty });
}

function dimensionScores(result: ReturnType<typeof resultFor>) {
  return Object.fromEntries(result.results.map((item) => [
    item.propertyId,
    Object.fromEntries(item.dimensions.map((dimension) => [dimension.key, dimension.score])),
  ])) as Record<string, Record<DimensionKey, number | null>>;
}

// A-D: safe affordability zone and over-budget penalties.
assert.equal(calculateBudgetMatchScore(220, 300), 100);
assert.equal(calculateBudgetMatchScore(250, 300), 100);
assert.equal(calculateBudgetMatchScore(295, 300), 86);
assert.equal(calculateBudgetMatchScore(320, 300), 35);
assert.equal(calculateBudgetMatchScore(350, 300), 15);

// E: affordability cannot create transaction-price reasonableness without comparables.
const transactionEvaluation = scoreTransactionPriceReasonableness({
  property: property("cheap", 180),
  preferences: preferences(),
  asOfDate: "2026-08-28",
  weights: calculateWeights("self_use", preferences().topPriorities),
});
assert.equal(transactionEvaluation.score, null);
assert.equal(transactionEvaluation.status, "partial");

// F-H: minimal, explicit priority mappings and education-none semantics.
assert.deepEqual(getPriorityDimensions("price"), ["budget_match", "transaction_price_reasonableness"]);
assert.ok(!getPriorityDimensions("price").includes("liquidity"));
assert.ok(!getPriorityDimensions("price").includes("value_preservation"));
assert.deepEqual(getPriorityDimensions("community_quality"), ["community_quality"]);
const communityPrioritized = calculateWeights("self_use", ["price", "community_quality", "education"]);
const communityUnprioritized = calculateWeights("self_use", ["price", "commute", "education"]);
assert.ok(communityPrioritized.community_quality > communityUnprioritized.community_quality);
const educationNone = resultFor([property("education-none", 250)]).results[0].dimensions.find((item) => item.key === "education");
assert.equal(educationNone?.score, null);
assert.equal(educationNone?.status, "known");
assert.deepEqual(educationNone?.missingInputs, []);

// I-J: priority order changes weights, never raw evidence-derived scores.
const firstOrder = resultFor([property("same", 250)], preferences(["price", "community_quality", "education"]));
const secondOrder = resultFor([property("same", 250)], preferences(["community_quality", "price", "education"]));
assert.notEqual(firstOrder.intendedWeights!.budget_match, secondOrder.intendedWeights!.budget_match);
assert.notEqual(firstOrder.intendedWeights!.community_quality, secondOrder.intendedWeights!.community_quality);
assert.deepEqual(dimensionScores(firstOrder), dimensionScores(secondOrder));

// K: normalized weights total 100 (within floating-point precision).
const normalizedTotal = DIMENSION_KEYS.reduce((sum, key) => sum + firstOrder.weights[key], 0);
assert.ok(Math.abs(normalizedTotal - 100) < 1e-9);
assert.equal(Object.values(BASE_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);

// L: missing evidence remains null rather than becoming zero.
const unknownCommunity = firstOrder.results[0].dimensions.find((item) => item.key === "community_quality");
assert.equal(unknownCommunity?.status, "unknown");
assert.equal(unknownCommunity?.score, null);

// M: identical inputs yield identical deterministic ranking and scores.
const deterministicProperties = [property("b", 250), property("a", 250)];
const deterministicOne = resultFor(deterministicProperties);
const deterministicTwo = resultFor(deterministicProperties);
assert.deepEqual(deterministicOne.ranking, deterministicTwo.ranking);
assert.deepEqual(deterministicOne.results.map((item) => item.overallScore), deterministicTwo.results.map((item) => item.overallScore));

console.log("Phase 11A deterministic tests A-M: PASS");

// Representative engine run used by the acceptance report. Community quality remains unknown
// because Phase 11A deliberately does not introduce a new scorer for that dimension.
const representativePreferences: BuyerPreferences = {
  ...preferences(),
  primaryWorkLocation: "测试工作地点",
  primaryCommuteMode: "driving",
  primaryIdealCommuteMinutes: 30,
  primaryMaxCommuteMinutes: 45,
  commuteMode: "driving",
  idealCommuteMinutes: 30,
  maxCommuteMinutes: 45,
};
const representativeProperties = [property("property-a", 228, 113), property("property-b", 218, 126)];
const representativeGeo: GeoEvidenceByProperty = Object.fromEntries(representativeProperties.map((item, index) => [item.id, {
  commute: {
    dimension: "commute",
    source: "amap",
    fetchedAt: now,
    status: "verified",
    quality: "high",
    observation: "测试路线证据",
    primary: {
      destinationLabel: "测试工作地点",
      requestedMode: "driving",
      modeResults: { driving: { minutes: index === 0 ? 42 : 30, distanceMeters: index === 0 ? 25_000 : 18_000 } },
      selectedMode: "driving",
      selectedMinutes: index === 0 ? 42 : 30,
      status: "verified",
      quality: "high",
      fetchedAt: now,
    },
  },
  commercial_amenities: {
    dimension: "commercial_amenities",
    source: "amap",
    fetchedAt: now,
    status: "verified",
    quality: "high",
    observation: "测试商业证据",
    countWithin2000m: index === 0 ? 2 : 4,
    nearestDistanceMeters: index === 0 ? 1_200 : 700,
    examples: index === 0 ? ["商业体甲", "商业体乙"] : ["商业体甲", "商业体乙", "商业体丙", "商业体丁"],
  },
}])) as GeoEvidenceByProperty;
const representativeAfter = resultFor(representativeProperties, representativePreferences, representativeGeo);
const oldBaseWeights: Record<DimensionKey, number> = {
  location_maturity: 6,
  commute: 10,
  public_transport: 6,
  commercial_amenities: 5,
  education: 6,
  medical_amenities: 3,
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
const oldRawWeights = Object.fromEntries(DIMENSION_KEYS.map((key) => {
  const selfUseMultiplier = ["commute", "education", "layout_design", "space_match", "community_quality", "property_management"].includes(key)
    ? 1.1
    : ["liquidity", "value_preservation"].includes(key) ? 0.95 : 1;
  const priorityMultiplier = getPriorityDimensions("price").includes(key) ? 1.6
    : getPriorityDimensions("community_quality").includes(key) ? 1.4
      : getPriorityDimensions("education").includes(key) ? 1.2 : 1;
  return [key, oldBaseWeights[key] * selfUseMultiplier * priorityMultiplier];
})) as Record<DimensionKey, number>;
const oldRawTotal = DIMENSION_KEYS.reduce((sum, key) => sum + oldRawWeights[key], 0);
const oldWeights = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, oldRawWeights[key] / oldRawTotal * 100])) as Record<DimensionKey, number>;
const oldOverallScores = Object.fromEntries(representativeAfter.results.map((item) => {
  const scored = item.dimensions.filter((dimension) => dimension.score !== null);
  const denominator = scored.reduce((sum, dimension) => sum + oldWeights[dimension.key], 0);
  const score = Math.round(scored.reduce((sum, dimension) => sum + dimension.score! * oldWeights[dimension.key], 0) / denominator);
  return [item.propertyId, score];
}));
console.log("Phase 11A representative BEFORE:", JSON.stringify({
  ranking: Object.entries(oldOverallScores).sort((left, right) => right[1] - left[1]).map(([propertyId]) => propertyId),
  overallScores: oldOverallScores,
  budgetScores: { "property-a": 100, "property-b": 100 },
  weights: oldWeights,
}));
console.log("Phase 11A representative AFTER:", JSON.stringify({
  ranking: representativeAfter.ranking,
  overallScores: Object.fromEntries(representativeAfter.results.map((item) => [item.propertyId, item.overallScore])),
  budgetScores: Object.fromEntries(representativeAfter.results.map((item) => [item.propertyId, item.dimensions.find((dimension) => dimension.key === "budget_match")?.score])),
  communityScores: Object.fromEntries(representativeAfter.results.map((item) => [item.propertyId, item.dimensions.find((dimension) => dimension.key === "community_quality")?.score])),
  weights: representativeAfter.weights,
}));
