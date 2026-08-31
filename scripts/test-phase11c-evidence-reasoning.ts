import assert from "node:assert/strict";
import { createAIAnalysisRequest } from "../lib/ai/request";
import { createAIAnalysisPrompt } from "../lib/ai/prompt";
import { validateAIAnalysisRequest, validateAIAnalysisResponse, type AINarrativeConsistencyConstraint } from "../lib/ai/validation";
import { runSingleRequestGeneration, shouldRetryAIAnalysisValidation } from "../lib/ai/corrective-retry";
import { createDemoBuyerPreferences, createDemoProperties } from "../lib/demo/demo-data";
import { runDecisionEngine } from "../lib/decision/engine";
import type { AIAnalysis, AIAnalysisRequest, AIAnalysisResponse } from "../types/ai-analysis";
import type { BuyerPreferences } from "../types/buyer-preferences";
import type { GeoEvidenceByProperty } from "../types/geo-evidence";
import type { Property } from "../types/property";
import type { PropertyWebEvidence, VerifiedEvidenceItem, WebEvidenceByProperty, WebEvidenceDimensionKey } from "../lib/web-evidence/types";
import { WEB_EVIDENCE_PROVIDER_ID, WEB_EVIDENCE_TARGET_DIMENSIONS, WEB_EVIDENCE_VERSION } from "../lib/web-evidence/types";

const now = "2026-08-29T00:00:00.000Z";

function verifiedItem(propertyId: string, dimension: WebEvidenceDimensionKey, status: VerifiedEvidenceItem["status"], value: string | number): VerifiedEvidenceItem {
  return {
    propertyId,
    dimension,
    key: dimension === "community_quality" ? "floor_area_ratio" : "market_context",
    value,
    evidenceKind: dimension === "community_quality" ? "scoreable" : "contextual",
    sourceType: "web",
    sourceTitle: "项目公开资料",
    sourceUrl: "https://example.gov.cn/project",
    sourceDomain: "example.gov.cn",
    retrievedAt: now,
    confidence: status === "verified" ? "high" : "medium",
    corroborationCount: status === "verified" ? 2 : 1,
    status,
    sources: [{ sourceType: "web", sourceTitle: "项目公开资料", sourceUrl: "https://example.gov.cn/project", sourceDomain: "example.gov.cn", retrievedAt: now, tier: "A" }],
  };
}

function webEvidence(propertyId: string, items: VerifiedEvidenceItem[]): PropertyWebEvidence {
  return {
    propertyId,
    propertyIdentitySignature: `identity-${propertyId}`,
    dimensions: WEB_EVIDENCE_TARGET_DIMENSIONS.map((dimensionKey) => {
      const dimensionItems = items.filter((item) => item.dimension === dimensionKey);
      return {
        dimensionKey,
        status: dimensionItems.some((item) => item.status === "verified") ? "verified" as const : dimensionItems.length ? "partial" as const : "unavailable" as const,
        summary: dimensionItems.length ? "现有公开资料可提供部分项目结构信息，仍需核验。" : "当前缺少足够公开证据。",
        facts: dimensionItems.map((item) => ({ claim: `${item.key}: ${item.value}`, value: item.value, sourceTitle: item.sourceTitle ?? "项目公开资料", sourceUrl: item.sourceUrl ?? "https://example.gov.cn/project", sourceDomain: item.sourceDomain, fetchedAt: now, confidence: item.confidence })),
        verifiedEvidence: dimensionItems,
      };
    }),
    fetchedAt: now,
    version: WEB_EVIDENCE_VERSION,
    providerId: WEB_EVIDENCE_PROVIDER_ID,
  };
}

function buildScenario(educationNeed: BuyerPreferences["educationNeed"] = "none", includeEducationConflict = false): AIAnalysisRequest {
  const base = createDemoProperties().slice(0, 2);
  const properties: Property[] = base.map((item, index) => ({
    ...item,
    id: index === 0 ? "zhaoshang-zhenyuan" : "lvdi-cancan-2",
    name: index === 0 ? "招商·臻园" : "绿地·璀璨家园2期",
    city: "佛山市",
    district: "禅城区",
    totalPrice: index === 0 ? 228 : 275,
    listingPrice: index === 0 ? 250 : 288,
    area: index === 0 ? 113 : 126,
    deliveryYear: index === 0 ? 2025 : 2005,
  }));
  const basePreferences = createDemoBuyerPreferences();
  const preferences: BuyerPreferences = {
    ...basePreferences,
    maximumBudget: 288,
    educationNeed,
    educationStages: [],
    topPriorities: includeEducationConflict
      ? ["community_quality", "education", "commute"]
      : educationNeed === "none"
      ? ["community_quality", "commute", "commercial_amenities"]
      : ["community_quality", "education", "commute"],
    primaryWorkLocation: "测试工作地点",
    commuteMode: "driving",
    idealCommuteMinutes: 45,
    maxCommuteMinutes: 60,
    primaryCommuteMode: "driving",
    primaryIdealCommuteMinutes: 45,
    primaryMaxCommuteMinutes: 60,
  };
  const geoEvidenceByProperty = Object.fromEntries(properties.map((property, index) => [property.id, {
    commute: {
      dimension: "commute", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "通勤路线参考",
      primary: { destinationLabel: "测试工作地点", requestedMode: "driving", modeResults: { driving: { minutes: index === 0 ? 31 : 27, distanceMeters: index === 0 ? 21000 : 18000 } }, selectedMode: "driving", selectedMinutes: index === 0 ? 31 : 27, status: "verified", quality: "high", fetchedAt: now },
    },
    commercial_amenities: { dimension: "commercial_amenities", source: "amap", fetchedAt: now, status: "verified", quality: "high", observation: "商业配套", countWithin2000m: 4, nearestDistanceMeters: 650, examples: ["商业体甲"] },
  }])) as unknown as GeoEvidenceByProperty;
  const webEvidenceByProperty: WebEvidenceByProperty = {
    [properties[0].id]: webEvidence(properties[0].id, [
      verifiedItem(properties[0].id, "community_quality", "partially_verified", 3.5),
      verifiedItem(properties[0].id, "liquidity", "conflicting", "挂牌活跃度说法不一致"),
    ]),
    [properties[1].id]: webEvidence(properties[1].id, [verifiedItem(properties[1].id, "community_quality", "verified", 3.2)]),
  };
  const engine = runDecisionEngine({ properties, preferences, asOfDate: "2026-08-29", geoEvidenceByProperty, webEvidenceByProperty });
  return createAIAnalysisRequest({ properties, preferences, engine, geoEvidenceByProperty, webEvidenceByProperty });
}

function consistency(request: AIAnalysisRequest, requireStructure = true): AINarrativeConsistencyConstraint {
  return {
    educationNeed: request.context.preferences.educationNeed,
    comparisons: request.context.candidateComparisons,
    topPropertyName: request.context.candidates[0].property.name ?? undefined,
    dimensions: request.context.candidates[0].decision.dimensions.map(({ key, label, score, status }) => ({ key, label, score, status })),
    evidencePack: request.evidencePack,
    effectivePriorities: request.effectivePriorities,
    requireEvidenceGroundedStructure: requireStructure,
    knownDecisionContext: request.knownDecisionContext,
  };
}

function response(request: AIAnalysisRequest, overrides: Partial<AIAnalysis> = {}): AIAnalysisResponse {
  const top = request.evidencePack.candidates[0];
  const alternative = request.evidencePack.candidates[1];
  const topMinutes = top.amapEvidence?.commute?.primary?.selectedMinutes;
  const alternativeMinutes = alternative.amapEvidence?.commute?.primary?.selectedMinutes;
  const commercial = top.dimensionResults.find((item) => item.key === "commercial_amenities")?.score;
  const analysis: AIAnalysis = {
    topPropertyId: top.property.id,
    topPropertyName: top.property.name,
    decisionSummary: `${top.property.name}仍是当前排序下的首选。小区品质方面，目前可查资料只支持谨慎判断；通勤方面，${top.property.name}约${topMinutes}分钟、${alternative.property.name}约${alternativeMinutes}分钟；商业配套方面，当前评分为${commercial}，两套房需结合相同口径理解。`,
    decisionFactors: request.knownDecisionContext.decisiveKnownFactors.map((factor) => ({
      dimensionId: factor.dimension,
      priorityRank: factor.priorityRank,
      comparison: `${factor.label}按当前已知事实比较。`,
      verdict: factor.relation === "top_worse" ? `${alternative.property.name}在该项更强。` : "该项差异按当前关系表述。",
      reasoning: factor.priorityRank ? `这是第${factor.priorityRank}优先项。` : "这是当前已知的重要因素。",
    })),
    whyWinner: `${top.property.name}基于当前可比因素的整体组合保持首选。`,
    attentionItems: request.knownDecisionContext.attentionCandidates.map((item) => item.reason),
    topPriorityAnalysis: [
      { priority: "community_quality", analysis: "小区品质方面，现有公开资料显示部分结构信息，但实际居住体验仍需核验。" },
      { priority: "commute", analysis: `通勤方面，${alternative.property.name}约${alternativeMinutes}分钟，比${top.property.name}约${topMinutes}分钟更短，但两者都在可接受范围。` },
      { priority: "commercial_amenities", analysis: `商业配套方面，当前评分为${commercial}，两套房没有可据此夸大的明显差异。` },
    ],
    tradeoff: `与${alternative.property.name}相比，${top.property.name}维持当前整体排序，但会放弃部分通勤时间优势；另一套建筑面积为${alternative.property.area}㎡，首选为${top.property.area}㎡。`,
    additionalInsight: [`非核心偏好中，两套房预期成交价分别为${top.property.totalPrice}万元和${alternative.property.totalPrice}万元。`],
    risksOrUnknowns: ["小区品质的实际居住感受仍待实地确认。"],
    pendingEvidence: [],
    disclaimer: "本解读基于当前已知信息与房源比较结果，不替代实地核验和专业意见。",
    ...overrides,
  };
  return { ok: true, analysis, metadata: { generatedAt: now, inputSignature: request.inputSignature, provider: "zhipu", model: "test-model" } };
}

function validate(request: AIAnalysisRequest, candidate: AIAnalysisResponse) {
  return validateAIAnalysisResponse(candidate, request.context.authoritativeTopPropertyId, request.context.candidates[0].property.name ?? undefined, [request.context.candidates[1].property.name!], false, consistency(request));
}

async function main(): Promise<void> {
  const request = buildScenario();
  assert.equal(validateAIAnalysisRequest(request).success, true, "runtime request must preserve a self-consistent authoritative Evidence Pack");
  const prompt = createAIAnalysisPrompt(request);
  assert.ok(prompt.includes('"knownDecisionContext"') && !prompt.includes('"requiredFacts"') && !prompt.includes('"evidencePack"'), "A: normal model input must use the closed-world KnownDecisionContext, not Narrative Facts or the full audit pack");
  assert.deepEqual(request.effectivePriorities, ["commute", "commercial_amenities"], "B: only Top3 priorities with candidate-comparable evidence must reach the model");
  assert.ok(request.evidencePack.candidates.some((candidate) => candidate.contextualVerifiedEvidence.some((item) => item.dimension === "liquidity")), "C: important non-Top3 evidence must remain available");

  const valid = response(request);
  assert.equal(validate(request, valid).success, true, "baseline evidence-grounded response must pass");
  assert.equal(validate(request, response(request, { topPropertyId: request.evidencePack.candidates[1].property.id })).success, false, "D: model cannot change Top1");
  assert.equal(validate(request, response(request, { tradeoff: `${request.evidencePack.candidates[0].property.name}通勤更短，明显优于${request.evidencePack.candidates[1].property.name}。` })).success, false, "E: reversed comparison must fail");
  assert.equal(validate(request, response(request, { additionalInsight: ["房源另有999万元资金空间。"] })).success, false, "F: invented numeric facts must fail");
  assert.equal(validate(request, response(request, { additionalInsight: [`${request.evidencePack.candidates[0].property.listingPrice}万元成交价已经确定。`] })).success, false, "G: listing price cannot become transaction price");
  assert.equal(validate(request, response(request, { topPriorityAnalysis: [{ priority: "community_quality", analysis: "小区品质优秀且已经确认。" }, ...(valid.ok ? valid.analysis.topPriorityAnalysis!.slice(1) : [])] })).success, false, "H: unknown evidence cannot become a confirmed positive");
  assert.equal(validate(request, response(request, { topPriorityAnalysis: [{ priority: "community_quality", analysis: "现有公开资料显示容积率为3.5，但小区品质仍需核验。" }, ...(valid.ok ? valid.analysis.topPriorityAnalysis!.slice(1) : [])] })).success, true, "I: partial evidence may be used with cautious semantics");
  assert.equal(validate(request, response(request, { additionalInsight: ["挂牌活跃度说法不一致，说明流动性确定更好。"] })).success, false, "J: conflicting evidence cannot support a positive conclusion");

  const educationConflict = buildScenario("none", true);
  assert.deepEqual(educationConflict.evidencePack.buyerContext.topPriorities, ["community_quality", "education", "commute"]);
  assert.deepEqual(educationConflict.effectivePriorities, ["commute"], "K: education and other non-comparable priorities are removed from effective reasoning");
  assert.ok(request.evidencePack.candidateComparisons[0].dimensions.some((item) => item.relation === "top_worse") || request.context.candidateComparisons?.buildingArea.relation === "TOP1_SMALLER", "L: the alternative may legitimately win an individual dimension without changing Top1 authority");

  const close = structuredClone(request);
  close.evidencePack.candidates[1].overallScore = close.evidencePack.candidates[0].overallScore === null ? null : close.evidencePack.candidates[0].overallScore - 1;
  const closeBase = response(close) as Extract<AIAnalysisResponse, { ok: true }>;
  const closeInvalid = response(close, { decisionSummary: closeBase.analysis.decisionSummary + " 当前首选毫无悬念地显著胜出。" });
  assert.equal(validateAIAnalysisResponse(closeInvalid, close.context.authoritativeTopPropertyId, close.context.candidates[0].property.name ?? undefined, [close.context.candidates[1].property.name!], false, consistency(close)).success, false, "M: close ranking must not be exaggerated");
  const wordingVariation = response(request, { tradeoff: `若把选择看作取舍，${request.evidencePack.candidates[1].property.name}节省通勤时间，而当前首选保留既有整体排序。` });
  assert.equal(validate(request, wordingVariation).success, true, "N: factual wording variation must not fail due to prose template differences");

  let calls = 0;
  const lifecycle = await runSingleRequestGeneration({
    initialPrompt: prompt,
    generate: async () => JSON.stringify(++calls === 1 ? { ...(valid.ok ? valid.analysis : {}), topPropertyId: "invented" } : (valid.ok ? valid.analysis : {})),
    validate: (analysis) => validate(request, { ok: true, analysis: analysis as AIAnalysis, metadata: { generatedAt: now, inputSignature: request.inputSignature, provider: "zhipu", model: "test-model" } }),
    createCorrectivePrompt: () => prompt,
    shouldRetry: shouldRetryAIAnalysisValidation,
    buildFallback: () => valid,
  });
  // Top1 authority is a hard failure by design, so use a correctable comparison issue for O.
  assert.equal(lifecycle.source, "deterministic_fallback");
  calls = 0;
  const corrected = await runSingleRequestGeneration({
    initialPrompt: prompt,
    generate: async () => JSON.stringify(++calls === 1 ? (response(request, { tradeoff: `${request.evidencePack.candidates[0].property.name}通勤更短，优于${request.evidencePack.candidates[1].property.name}。` }) as Extract<AIAnalysisResponse, { ok: true }>).analysis : (valid as Extract<AIAnalysisResponse, { ok: true }>).analysis),
    validate: (analysis) => validate(request, { ok: true, analysis: analysis as AIAnalysis, metadata: { generatedAt: now, inputSignature: request.inputSignature, provider: "zhipu", model: "test-model" } }),
    createCorrectivePrompt: () => prompt,
    shouldRetry: shouldRetryAIAnalysisValidation,
    buildFallback: () => valid,
  });
  assert.equal(corrected.source, "model", "O: correctable first output must reach corrected second output");
  assert.equal(calls, 2, "O: corrective path must remain bounded to two model calls");

  console.log("Phase 11C evidence-grounded reasoning tests A-R: PASS");
  console.log("Phase 11C representative summary:", JSON.stringify({
    authoritativeTop1: request.evidencePack.candidates[0].property.name,
    alternative: request.evidencePack.candidates[1].property.name,
    effectiveTop3: request.effectivePriorities,
    allTop3Addressed: (valid as Extract<AIAnalysisResponse, { ok: true }>).analysis.topPriorityAnalysis?.length === 3,
    nonTop3Insight: (valid as Extract<AIAnalysisResponse, { ok: true }>).analysis.additionalInsight?.[0],
    rankingChanged: false,
  }));
}

void main();
