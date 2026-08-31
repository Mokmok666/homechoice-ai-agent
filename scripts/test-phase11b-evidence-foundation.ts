import assert from "node:assert/strict";
import type { BuyerPreferences } from "../types/buyer-preferences";
import type { Property } from "../types/property";
import type { DimensionWebEvidence, NormalizedWebSearchResult, PropertyWebEvidence, WebEvidenceByProperty, WebEvidenceDimensionKey } from "../lib/web-evidence/types";
import { WEB_EVIDENCE_TARGET_DIMENSIONS, WEB_EVIDENCE_VERSION, WEB_EVIDENCE_PROVIDER_ID } from "../lib/web-evidence/types";
import { normalizeDimensionWebEvidence } from "../lib/web-evidence/normalize";
import { buildPropertyWebQueries, createPropertyIdentitySignature, projectWebEvidencePropertyIdentity } from "../lib/web-evidence/query-builder";
import { runDecisionEngine } from "../lib/decision/engine";
import { buildDecisionEvidencePack } from "../lib/decision-evidence-pack";
import type { GeoEvidenceByProperty } from "../types/geo-evidence";
import { createWebEvidenceInterpretationSignature } from "../lib/web-evidence/interpretation-signature";
import { validateWebEvidenceInterpretationOutput } from "../lib/ai/web-evidence-interpretation-validation";

const fetchedAt = "2026-08-28T00:00:00.000Z";
const asOfDate = "2026-08-28";

function property(id: string, name = `房源${id}`, totalPrice = 228, deliveryYear: number | null = null): Property {
  return {
    id, name, city: "佛山市", district: "禅城区", address: "测试路1号", totalPrice, area: 113,
    layout: "3室2厅2卫", rooms: 3, livingRooms: 2, bathrooms: 2, floor: "中楼层", floorLevel: "middle",
    floorNumber: 10, totalFloors: 30, metroDistance: null, schoolInformation: "", propertyManagementInformation: "",
    comparableTransactions: [], deliveryYear, orientation: "south", status: "completed", source: "manual", createdAt: fetchedAt, updatedAt: fetchedAt,
  };
}

function preferences(): BuyerPreferences {
  return {
    id: "preferences", purchasePurpose: "self_use", maximumBudget: 300, primaryWorkLocation: "", partnerWorkLocation: null,
    commuteMode: "not_important", idealCommuteMinutes: null, maxCommuteMinutes: null, educationNeed: "none", educationStages: [],
    topPriorities: ["community_quality", "commute", "commercial_amenities"], createdAt: fetchedAt, updatedAt: fetchedAt,
  };
}

function result(title: string, snippet: string, domain: string, confidence: "high" | "medium" | "low" = "medium"): NormalizedWebSearchResult {
  return { title, url: `https://${domain}/${encodeURIComponent(title)}`, snippet, sourceDomain: domain, fetchedAt, credibilityHint: confidence };
}

function unavailable(dimensionKey: WebEvidenceDimensionKey): DimensionWebEvidence {
  return { dimensionKey, status: "unavailable", summary: "当前缺少足够公开证据，暂不判断。", facts: [], verifiedEvidence: [] };
}

function evidenceFor(item: Property, dimensions: DimensionWebEvidence[]): PropertyWebEvidence {
  const byKey = new Map(dimensions.map((dimension) => [dimension.dimensionKey, dimension]));
  return {
    propertyId: item.id,
    propertyIdentitySignature: createPropertyIdentitySignature(projectWebEvidencePropertyIdentity(item)),
    dimensions: WEB_EVIDENCE_TARGET_DIMENSIONS.map((key) => byKey.get(key) ?? unavailable(key)),
    fetchedAt,
    version: WEB_EVIDENCE_VERSION,
    providerId: WEB_EVIDENCE_PROVIDER_ID,
  };
}

function engine(properties: Property[], webEvidenceByProperty: WebEvidenceByProperty = {}) {
  return runDecisionEngine({ properties, preferences: preferences(), asOfDate, webEvidenceByProperty });
}

const communityVerified = normalizeDimensionWebEvidence("a", "community_quality", [
  result("招商·臻园项目资料", "招商·臻园容积率3.5，绿化率30%，总户数650户。", "source-a.com", "medium"),
  result("招商·臻园基础信息", "招商·臻园容积率3.5，绿化率30%，总户数650户。", "source-b.com", "medium"),
]);

// A-B: objective community facts are scoreable evidence, but no arbitrary community scorer is invented.
assert.ok(communityVerified.verifiedEvidence?.some((item) => item.key === "floor_area_ratio" && item.status === "verified"));
const a = property("a", "招商·臻园");
const aEngine = engine([a], { a: evidenceFor(a, [communityVerified]) });
assert.equal(aEngine.results[0].dimensions.find((item) => item.key === "community_quality")?.score, null);

// C-D: one weak source is insufficient; two independent medium sources corroborate.
const weak = normalizeDimensionWebEvidence("a", "community_quality", [result("论坛资料", "招商·臻园容积率3.5。", "weak.example", "low")]);
assert.equal(weak.verifiedEvidence?.find((item) => item.key === "floor_area_ratio")?.status, "insufficient");
assert.equal(communityVerified.verifiedEvidence?.find((item) => item.key === "floor_area_ratio")?.status, "verified");

// E: conflicting authoritative values remain conflicting and cannot score.
const conflict = normalizeDimensionWebEvidence("a", "community_quality", [
  result("官方资料甲", "招商·臻园容积率3.5。", "a.gov.cn", "high"),
  result("官方资料乙", "招商·臻园容积率5.2。", "b.gov.cn", "high"),
]);
assert.ok(conflict.verifiedEvidence?.filter((item) => item.key === "floor_area_ratio").every((item) => item.status === "conflicting"));

// F: company and fee are contextual facts, never an automatic high service score.
const management = normalizeDimensionWebEvidence("a", "property_management", [
  result("项目物业", "招商·臻园物业公司为招商积余，物业费3.2元。", "source-a.com", "medium"),
  result("物业资料", "招商·臻园物业公司为招商积余，物业费3.2元。", "source-b.com", "medium"),
]);
const managementEngine = engine([a], { a: evidenceFor(a, [management]) });
assert.equal(managementEngine.results[0].dimensions.find((item) => item.key === "property_management")?.score, null);
assert.ok(management.verifiedEvidence?.some((item) => item.key === "property_fee" && item.evidenceKind === "contextual"));

// G: verified completion year feeds the existing deterministic building-age scorer.
const buildingAge = normalizeDimensionWebEvidence("a", "building_age", [result("官方交付信息", "招商·臻园于2020年交付。", "housing.foshan.gov.cn", "high")]);
const buildingEngine = engine([a], { a: evidenceFor(a, [buildingAge]) });
assert.equal(buildingEngine.results[0].dimensions.find((item) => item.key === "building_age")?.score, 90);

// H-K: listing is not transaction; 2 comps stay null; 3 valid comps score; low expected price alone proves nothing.
const listing = normalizeDimensionWebEvidence("a", "transaction_price_reasonableness", [result("二手挂牌", "招商·臻园挂牌255万，在售房源。", "ke.com")]);
assert.ok(listing.facts.every((fact) => fact.transactionKind === "listing"));
assert.ok(listing.verifiedEvidence?.some((item) => item.key === "listing_evidence" && item.evidenceKind === "contextual"));
const twoComps = property("two", "两条成交", 220, 2020);
twoComps.comparableTransactions = [1, 2].map((id) => ({ id: String(id), price: 225 + id, area: 113, transactionDate: `2026-0${id}-01`, source: "已确认来源", confirmed: true }));
assert.equal(engine([twoComps]).results[0].dimensions.find((item) => item.key === "transaction_price_reasonableness")?.score, null);
const threeComps = { ...twoComps, id: "three", comparableTransactions: [...twoComps.comparableTransactions, { id: "3", price: 228, area: 113, transactionDate: "2026-03-01", source: "已确认来源", confirmed: true }] };
assert.notEqual(engine([threeComps]).results[0].dimensions.find((item) => item.key === "transaction_price_reasonableness")?.score, null);
assert.equal(engine([property("cheap", "低价", 180)]).results[0].dimensions.find((item) => item.key === "transaction_price_reasonableness")?.score, null);

// L-M: liquidity and layout context survive while their scores remain null.
const liquidity = normalizeDimensionWebEvidence("a", "liquidity", [result("在售资料", "招商·臻园当前有12套二手房挂牌。", "ke.com")]);
const layout = normalizeDimensionWebEvidence("a", "layout_design", [result("户型资料", "招商·臻园113㎡户型为2梯4户，朝南。", "source-a.com")]);
const contextEngine = engine([a], { a: evidenceFor(a, [liquidity, layout]) });
assert.equal(contextEngine.results[0].dimensions.find((item) => item.key === "liquidity")?.score, null);
assert.equal(contextEngine.results[0].dimensions.find((item) => item.key === "layout_design")?.score, null);
assert.ok(layout.verifiedEvidence?.some((item) => item.key === "elevator_unit_ratio"));

// N: complete Web failure is equivalent to unavailable evidence and never blocks the engine.
assert.equal(engine([a]).ranking[0], "a");

// O-P-Q-R-S: existing defensible property-service scoring can participate, but priority never forces winner and wording cannot affect structured year scoring.
const supportedService = normalizeDimensionWebEvidence("a", "property_management", [
  result("招商·臻园服务记录", "招商·臻园物业服务维护良好，响应及时。", "source-a.com", "medium"),
  result("招商·臻园维护资料", "招商·臻园物业服务维护良好，响应及时。", "source-b.com", "medium"),
]);
assert.equal(engine([a], { a: evidenceFor(a, [supportedService]) }).results[0].dimensions.find((item) => item.key === "property_management")?.score, 75);
const poorer = property("poorer", "另一房源", 360, 2000);
assert.equal(engine([poorer, a], { a: evidenceFor(a, [communityVerified]) }).ranking[0], "a");
const buildingAgeWording = normalizeDimensionWebEvidence("a", "building_age", [result("交付记录", "项目竣工年份为2020年。", "housing.foshan.gov.cn", "high")]);
assert.equal(engine([a], { a: evidenceFor(a, [buildingAgeWording]) }).results[0].dimensions.find((item) => item.key === "building_age")?.score, 90);
const fixed = property("fixed", "固定候选", 228, 2018);
const changing = property("changing", "证据变化候选", 228);
const oldCompletion = normalizeDimensionWebEvidence("changing", "building_age", [result("旧楼龄证据", "证据变化候选于2000年交付。", "housing.foshan.gov.cn", "high")]);
const newCompletion = normalizeDimensionWebEvidence("changing", "building_age", [result("新楼龄证据", "证据变化候选于2025年交付。", "housing.foshan.gov.cn", "high")]);
assert.equal(engine([fixed, changing], { changing: evidenceFor(changing, [oldCompletion]) }).ranking[0], "fixed");
assert.equal(engine([fixed, changing], { changing: evidenceFor(changing, [newCompletion]) }).ranking[0], "changing");

// T-U: AMap code is untouched by this phase; unknown remains null.
assert.equal(aEngine.results[0].dimensions.find((item) => item.key === "medical_amenities")?.score, null);
const amapEvidence: GeoEvidenceByProperty = { a: { commercial_amenities: { dimension: "commercial_amenities", source: "amap", fetchedAt, status: "verified", quality: "high", observation: "2公里内有4个商业体", countWithin2000m: 4, nearestDistanceMeters: 700, examples: ["商场甲"] } } };
const amapEngine = runDecisionEngine({ properties: [a], preferences: preferences(), asOfDate, geoEvidenceByProperty: amapEvidence });
assert.equal(amapEngine.results[0].dimensions.find((item) => item.key === "commercial_amenities")?.score, 100);

// V-W-X: every retained external fact is traceable and contextual evidence survives null scoring.
assert.ok(communityVerified.verifiedEvidence?.every((item) => item.sources.every((source) => /^https:\/\//.test(source.sourceUrl))));
assert.ok(liquidity.verifiedEvidence?.some((item) => item.evidenceKind === "contextual"));

// Y: near-name identities do not share signatures.
const sibling = property("a", "招商·樾园");
assert.notEqual(createPropertyIdentitySignature(projectWebEvidencePropertyIdentity(a)), createPropertyIdentitySignature(projectWebEvidencePropertyIdentity(sibling)));

// Z-AA: the pack preserves full buyer/property/15D/AMap/Web/decision data and is independent of Narrative Facts.
const packedWeb = { a: evidenceFor(a, [communityVerified, management, liquidity, layout, buildingAge]) };
const packedEngine = runDecisionEngine({ properties: [a, poorer], preferences: preferences(), asOfDate, geoEvidenceByProperty: amapEvidence, webEvidenceByProperty: packedWeb });
const pack = buildDecisionEvidencePack({ properties: [a, poorer], preferences: preferences(), engine: packedEngine, geoEvidenceByProperty: amapEvidence, webEvidenceByProperty: packedWeb, createdAt: fetchedAt });
assert.equal(pack.candidates[0].dimensionResults.length, 15);
assert.deepEqual(pack.priorities.map((item) => item.priority), preferences().topPriorities);
assert.ok(pack.candidates[0].scoreableWebEvidence.length > 0);
assert.ok(pack.candidates[0].contextualVerifiedEvidence.length > 0);
assert.equal(pack.buyerContext.maximumBudget, 300);
assert.equal(pack.topCandidate.propertyId, packedEngine.ranking[0]);
assert.equal(pack.candidates[0].amapEvidence?.commercial_amenities?.countWithin2000m, 4);
assert.equal(pack.candidateComparisons.length, 1);
assert.equal(pack.candidateComparisons[0].dimensions.length, 15);

// AB: Top3 dimensions are first, while non-Top3 discovery queries remain present.
const queries = buildPropertyWebQueries(projectWebEvidencePropertyIdentity(a), preferences().topPriorities);
assert.equal(queries[0].dimensionKey, "community_quality");
assert.ok(queries.some((item) => item.dimensionKey === "building_age"));
assert.ok(queries.some((item) => item.dimensionKey === "transaction_price_reasonableness"));

// Interpreter robustness: an omitted usable dimension receives a deterministic insufficient conclusion;
// malformed or unsupported output fields remain rejected.
const interpretationEvidence = evidenceFor(a, [communityVerified, management]);
const interpretationRequest = {
  property: projectWebEvidencePropertyIdentity(a),
  evidence: interpretationEvidence,
  interpretationSignature: createWebEvidenceInterpretationSignature(interpretationEvidence),
};
const partialModelOutput = validateWebEvidenceInterpretationOutput({
  propertyId: "a",
  dimensions: [{ dimensionKey: "community_quality", conclusion: "现有项目资料显示容积率和绿化率信息，但实际居住品质仍需进一步确认。", supportingFacts: ["容积率3.5，绿化率30%"] }],
}, interpretationRequest);
assert.equal(partialModelOutput.success, true);
if (partialModelOutput.success) assert.equal(partialModelOutput.data.dimensions.length, 2);
assert.equal(validateWebEvidenceInterpretationOutput({ propertyId: "a", dimensions: [], unexpected: true }, interpretationRequest).success, false);

console.log("Phase 11B deterministic tests A-AB: PASS");
const representativeB = property("b", "绿地·璀璨家园2期", 218);
representativeB.area = 126;
const representativePreferences: BuyerPreferences = {
  ...preferences(), primaryWorkLocation: "测试工作地点", commuteMode: "driving", idealCommuteMinutes: 30, maxCommuteMinutes: 45,
  primaryCommuteMode: "driving", primaryIdealCommuteMinutes: 30, primaryMaxCommuteMinutes: 45,
};
const representativeGeo: GeoEvidenceByProperty = Object.fromEntries([a, representativeB].map((item, index) => [item.id, {
  commute: {
    dimension: "commute", source: "amap", fetchedAt, status: "verified", quality: "high", observation: "测试通勤路线",
    primary: { destinationLabel: "测试工作地点", requestedMode: "driving", modeResults: { driving: { minutes: index === 0 ? 31 : 27, distanceMeters: 20_000 } }, selectedMode: "driving", selectedMinutes: index === 0 ? 31 : 27, status: "verified", quality: "high", fetchedAt },
  },
  commercial_amenities: { dimension: "commercial_amenities", source: "amap", fetchedAt, status: "verified", quality: "high", observation: "商业证据", countWithin2000m: 4, nearestDistanceMeters: 700, examples: ["商场甲"] },
}])) as GeoEvidenceByProperty;
const representativeBefore = runDecisionEngine({ properties: [a, representativeB], preferences: representativePreferences, asOfDate, geoEvidenceByProperty: representativeGeo });
const representativeAfter = runDecisionEngine({ properties: [a, representativeB], preferences: representativePreferences, asOfDate, geoEvidenceByProperty: representativeGeo, webEvidenceByProperty: { a: evidenceFor(a, [communityVerified]) } });
console.log("Phase 11B representative:", JSON.stringify({
  before: { communityStatus: "unknown", communityScore: null, totalScores: Object.fromEntries(representativeBefore.results.map((item) => [item.propertyId, item.overallScore])), ranking: representativeBefore.ranking },
  after: { communityEvidenceStatus: communityVerified.status, communityScore: representativeAfter.results.find((item) => item.propertyId === "a")?.dimensions.find((item) => item.key === "community_quality")?.score ?? null, contextualEvidenceCount: pack.candidates[0].contextualVerifiedEvidence.length, totalScores: Object.fromEntries(representativeAfter.results.map((item) => [item.propertyId, item.overallScore])), ranking: representativeAfter.ranking },
}));
