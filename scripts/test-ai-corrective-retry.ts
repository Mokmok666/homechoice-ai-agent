import assert from "node:assert/strict";
import { runSingleRequestGeneration, runValidationAwareGeneration, shouldRetryAIAnalysisValidation } from "../lib/ai/corrective-retry";
import { requestAIAnalysis, shouldApplyAIAnalysisResponse } from "../lib/ai/client";
import { validateAIAnalysisRequest, validateAIAnalysisResponse, type AINarrativeConsistencyConstraint } from "../lib/ai/validation";
import { AI_NARRATIVE_TEMPERATURE, generateAIAnalysis, ZhipuClientError } from "../lib/ai/zhipu-client";
import { findLatestAIAnalysisForProperty, saveAIAnalysisRecord } from "../lib/ai-analysis-storage";
import { buildNarrativeFacts } from "../lib/ai/narrative-facts";
import { createDeterministicNarrative } from "../lib/ai/deterministic-narrative";
import { createAIAnalysisPrompt } from "../lib/ai/prompt";
import { createAIInputSignature } from "../lib/ai/signature";
import { projectAIAnalysisContext } from "../lib/ai/input";
import { runDecisionEngine } from "../lib/decision/engine";
import { createDemoBuyerPreferences, createDemoProperties } from "../lib/demo/demo-data";
import { POST as analyzePost } from "../app/api/ai/analyze/route";
import type { AIAnalysisRequest, AIAnalysisResponse, AICandidateComparisonFacts } from "../types/ai-analysis";

const NARRATIVE_ISSUE = "analysis.decisionSummary reverses deterministic commute comparison";

function narrativeFactsRequest(): AIAnalysisRequest {
  const dimension = (key: string, label: string, score: number | null, status: "known" | "partial" | "unknown", finalWeight: number) => ({
    key,
    label,
    score,
    status,
    finalWeight,
    evidence: [],
    missingInputs: status === "unknown" ? [label] : [],
  });
  const topDimensions = [
    dimension("budget_match", "预算匹配", 100, "known", 18),
    dimension("commute", "通勤", 100, "known", 17),
    dimension("commercial_amenities", "商业配套", 100, "known", 12),
    dimension("community_quality", "小区品质", null, "unknown", 11),
    dimension("property_management", "物业服务", null, "unknown", 10),
    dimension("transaction_price_reasonableness", "成交价合理性", null, "unknown", 13),
    dimension("education", "教育", null, "unknown", 0),
  ];
  const comparisonFacts: AICandidateComparisonFacts = {
    primaryAlternativeId: "property-b",
    primaryAlternativeName: "龙湖·御湖境",
    dimensions: [
      { dimensionKey: "commercial_amenities", label: "商业配套", relation: "EQUAL", top1Score: 100, top2Score: 100 },
      { dimensionKey: "community_quality", label: "小区品质", relation: "UNKNOWN", top1Score: null, top2Score: null },
      { dimensionKey: "property_management", label: "物业服务", relation: "UNKNOWN", top1Score: null, top2Score: null },
      { dimensionKey: "transaction_price_reasonableness", label: "成交价合理性", relation: "UNKNOWN", top1Score: null, top2Score: null },
    ],
    commute: {
      relation: "TOP1_WORSE_BUT_WITHIN_TARGET",
      top1PrimaryMinutes: 31,
      top1PartnerMinutes: null,
      top2PrimaryMinutes: 27,
      top2PartnerMinutes: null,
      primaryIdealMinutes: 45,
      primaryMaxMinutes: 60,
      partnerIdealMinutes: null,
      partnerMaxMinutes: null,
      top1TargetStatus: "WITHIN_IDEAL",
    },
    budgetMatch: {
      relation: "TOP1_BETTER",
      maximumBudget: 288,
      top1ExpectedTransactionPrice: 228,
      top2ExpectedTransactionPrice: 238,
      top1BudgetMargin: 60,
      top2BudgetMargin: 50,
    },
    buildingArea: {
      relation: "EQUAL",
      top1SquareMeters: 100,
      top2SquareMeters: 100,
    },
  };
  return {
    schemaVersion: 2,
    locale: "zh-CN",
    inputSignature: "narrative-facts-test",
    context: {
      asOfDate: "2026-08-28",
      decisionVersion: "test-engine",
      authoritativeTopPropertyId: "property-a",
      ranking: ["property-a", "property-b"],
      rankingProvisional: true,
      preferences: {
        purchasePurpose: "self_occupied",
        maximumBudget: 288,
        primaryWorkplace: { label: "工作地点", confirmed: true, commuteMode: "driving", idealCommuteMinutes: 45, maxCommuteMinutes: 60 },
        partnerWorkplace: null,
        educationNeed: "none",
        educationStages: [],
        topPriorities: ["price", "commute", "commercial_amenities"],
      },
      candidates: [
        {
          property: { propertyId: "property-a", name: "招商·臻园", expectedTransactionPrice: 228, budgetDifference: 60 },
          decision: { propertyId: "property-a", propertyName: "招商·臻园", rank: 1, matchScore: 86, recommendation: "CONSIDER", dimensions: topDimensions },
          geoEvidence: {
            commute: {
              primary: { selectedMinutes: 31, idealCommuteMinutes: 45, maxCommuteMinutes: 60 },
              partner: null,
            },
          },
          webEvidence: null,
        },
        {
          property: { propertyId: "property-b", name: "龙湖·御湖境", expectedTransactionPrice: 238, budgetDifference: 50 },
          decision: { propertyId: "property-b", propertyName: "龙湖·御湖境", rank: 2, matchScore: 82, recommendation: "CONSIDER", dimensions: topDimensions },
          geoEvidence: null,
          webEvidence: null,
        },
      ],
      candidateComparisons: comparisonFacts,
    },
  } as unknown as AIAnalysisRequest;
}

function testNarrativeFactsBuilder(): void {
  const request = narrativeFactsRequest();
  const facts = buildNarrativeFacts(request);
  const budget = facts.requiredFacts.find((item) => item.kind === "BUDGET_WITHIN_RANGE");
  assert.ok(budget?.allowedMeaning.includes("228万元") && budget.allowedMeaning.includes("288万元"), "A: budget fact must preserve expected price and maximum budget");
  assert.ok(budget?.allowedMeaning.includes("预算") && !/市场价格合理|市场合理价/.test(budget.allowedMeaning), "A: budget fact must not claim market reasonableness");

  const commute = facts.comparisonFacts.find((item) => item.dimension === "commute");
  assert.equal(commute?.relationMeaning, "主要备选数值更优，但首选仍满足目标", "B: commute relation must preserve within-target nuance");
  assert.ok(commute?.allowedMeaning.includes("龙湖·御湖境") && commute.allowedMeaning.includes("更短") && commute.allowedMeaning.includes("仍满足"), "B: commute must acknowledge the faster alternative and Top1 target fit");
  assert.ok(!commute?.allowedMeaning.includes("首选的相对优势" ) || commute.allowedMeaning.includes("不能写成"), "B: commute must not become a Top1 advantage");

  const commercial = facts.comparisonFacts.find((item) => item.dimension === "commercial_amenities");
  assert.equal(commercial?.relationMeaning, "两者表现相当", "C: 100/100 commercial result must remain equal");
  assert.ok(!commercial?.allowedMeaning.includes("招商·臻园在商业配套的确定性比较中相对更强"), "C: equal commercial result must not create a Top1 advantage");

  const community = facts.uncertaintyFacts.find((item) => item.dimension === "community_quality");
  const management = facts.uncertaintyFacts.find((item) => item.dimension === "property_management");
  assert.ok(community?.allowedMeaning.includes("缺少足够证据") && community.allowedMeaning.includes("待确认"), "D: unknown community quality must remain pending");
  assert.ok(management?.allowedMeaning.includes("缺少足够证据") && management.allowedMeaning.includes("待确认"), "E: unknown property management must remain pending");

  assert.ok(!JSON.stringify(facts).includes('"dimension":"education"'), "F: education must be absent when educationNeed is none");
  assert.equal(facts.topCandidate.id, request.context.ranking[0], "G: Narrative Top1 must equal deterministic Top1");
  assert.deepEqual(facts.candidateOrder.map((item) => item.id), request.context.ranking, "H: candidate order must remain deterministic");
  assert.ok(facts.candidateOrder.every((item) => request.context.ranking.includes(item.id)), "I: facts must not invent candidates");

  const userFacingFacts = [
    ...facts.requiredFacts.map((item) => item.allowedMeaning),
    ...facts.comparisonFacts.map((item) => item.allowedMeaning),
    ...facts.uncertaintyFacts.map((item) => item.allowedMeaning),
    ...facts.nextStepFacts.map((item) => item.allowedMeaning),
    ...facts.prohibitedClaims.map((item) => item.guidance),
  ].join("\n");
  assert.ok(!/Evidence Gap|UNKNOWN|TOP1_BETTER|candidateComparisons|Narrative Facts|allowedMeaning/.test(userFacingFacts), "J: user-facing fact language must not contain internal terminology");

  const prompt = createAIAnalysisPrompt(request, facts);
  assert.ok(!prompt.includes('"context"'), "Prompt must not send the full AI decision context after facts projection");
  assert.ok(createAIInputSignature(request.context).startsWith("aia-v12-"), "Narrative architecture change must invalidate prior current-cache signatures");
  const totalFacts = facts.requiredFacts.length + facts.comparisonFacts.length + facts.uncertaintyFacts.length + facts.nextStepFacts.length;
  assert.ok(totalFacts >= 8 && totalFacts <= 12, `Narrative facts should remain compact; received ${totalFacts}`);
}

async function testRetryControlFlow(): Promise<void> {
  let calls = 0;
  const firstPass = await runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => { calls += 1; return JSON.stringify({ valid: true }); },
    validate: (value) => value && typeof value === "object" && (value as { valid?: boolean }).valid === true
      ? { success: true as const, data: value }
      : { success: false as const, errors: ["invalid"] },
    createCorrectivePrompt: () => "corrective",
    shouldRetry: shouldRetryAIAnalysisValidation,
  });
  assert.equal(firstPass.success, true);
  assert.equal(calls, 1, "K: first-pass success must call the model once");

  calls = 0;
  const corrected = await runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => JSON.stringify({ valid: ++calls === 2 }),
    validate: (value) => (value as { valid?: boolean }).valid === true
      ? { success: true as const, data: value }
      : { success: false as const, errors: [NARRATIVE_ISSUE] },
    createCorrectivePrompt: (issues) => { assert.deepEqual(issues, [NARRATIVE_ISSUE]); return "corrective"; },
    shouldRetry: shouldRetryAIAnalysisValidation,
  });
  assert.equal(corrected.success, true);
  assert.equal(calls, 2, "L: corrective success must call the model twice");

  calls = 0;
  const rejected = await runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => { calls += 1; return JSON.stringify({ valid: false }); },
    validate: () => ({ success: false as const, errors: [NARRATIVE_ISSUE] }),
    createCorrectivePrompt: () => "corrective",
    shouldRetry: shouldRetryAIAnalysisValidation,
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.reason, "validation_failed");
  assert.equal(calls, 2, "M: two invalid responses must stop after two calls");

  calls = 0;
  await assert.rejects(() => runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => { calls += 1; throw new ZhipuClientError("AI_TIMEOUT", "timeout", true); },
    validate: () => ({ success: true as const, data: {} }),
    createCorrectivePrompt: () => "corrective",
    shouldRetry: shouldRetryAIAnalysisValidation,
  }), (error: unknown) => error instanceof ZhipuClientError && error.code === "AI_TIMEOUT");
  assert.equal(calls, 1, "N: timeout must not trigger corrective retry");

  for (const providerError of [
    new ZhipuClientError("AI_NOT_CONFIGURED", "not configured", false),
    new ZhipuClientError("AI_PROVIDER_ERROR", "quota", false),
  ]) {
    calls = 0;
    await assert.rejects(() => runValidationAwareGeneration({
      initialPrompt: "base",
      generate: async () => { calls += 1; throw providerError; },
      validate: () => ({ success: true as const, data: {} }),
      createCorrectivePrompt: () => "corrective",
      shouldRetry: shouldRetryAIAnalysisValidation,
    }), (error: unknown) => error === providerError);
    assert.equal(calls, 1, "N: auth/quota provider errors must not retry");
  }

  calls = 0;
  const parseFailure = await runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => { calls += 1; return "not-json"; },
    validate: () => ({ success: true as const, data: {} }),
    createCorrectivePrompt: () => "corrective",
    shouldRetry: shouldRetryAIAnalysisValidation,
  });
  assert.equal(parseFailure.success, false);
  assert.equal(parseFailure.reason, "parse_failed");
  assert.equal(calls, 1, "N-extra: parse failure must not retry");

  calls = 0;
  const hardFailure = await runValidationAwareGeneration({
    initialPrompt: "base",
    generate: async () => { calls += 1; return JSON.stringify({ topPropertyId: "hallucinated" }); },
    validate: () => ({ success: false as const, errors: ["analysis.topPropertyId must equal deterministic Top1"] }),
    createCorrectivePrompt: () => "corrective",
    shouldRetry: shouldRetryAIAnalysisValidation,
  });
  assert.equal(hardFailure.success, false);
  assert.equal(calls, 1, "N-extra: hard Top1 authority failure must not retry");
  assert.equal(shouldRetryAIAnalysisValidation(["analysis.decisionSummary reverses deterministic commute comparison"]), true);
  for (const hardIssue of [
    "analysis contains unexpected fields",
    "analysis.topPropertyId must equal deterministic Top1",
    "analysis.topPropertyName must map to deterministic Top1 name",
    "analysis evidence or disclaimer is invalid",
  ]) {
    assert.equal(shouldRetryAIAnalysisValidation([hardIssue]), false, `Hard issue must not retry: ${hardIssue}`);
  }
}

async function testSingleClickLifecycle(): Promise<void> {
  const fallback = { final: "fallback" };
  const base = {
    initialPrompt: "base",
    validate: (value: unknown) => (value as { valid?: boolean }).valid === true
      ? { success: true as const, data: value as { valid: true } | typeof fallback }
      : { success: false as const, errors: [NARRATIVE_ISSUE] },
    createCorrectivePrompt: () => "corrective",
    shouldRetry: shouldRetryAIAnalysisValidation,
    buildFallback: () => fallback,
  };

  let calls = 0;
  const firstPass = await runSingleRequestGeneration({
    ...base,
    generate: async () => { calls += 1; return JSON.stringify({ valid: true }); },
  });
  assert.equal(firstPass.source, "model", "A: a valid first attempt must return the model result");
  assert.equal(calls, 1, "A: a valid first attempt must call the provider once");

  calls = 0;
  const corrected = await runSingleRequestGeneration({
    ...base,
    generate: async () => JSON.stringify({ valid: ++calls === 2 }),
  });
  assert.equal(corrected.source, "model", "B: a corrected second attempt must return one final success");
  assert.equal(calls, 2, "B: corrective generation must call the provider exactly twice");

  calls = 0;
  const validationFallback = await runSingleRequestGeneration({
    ...base,
    generate: async () => { calls += 1; return JSON.stringify({ valid: false }); },
  });
  assert.equal(validationFallback.source, "deterministic_fallback", "C: exhausted validation must return a deterministic fallback");
  assert.deepEqual(validationFallback.data, fallback, "C: the final result must remain usable");
  assert.equal(calls, 2, "C: exhausted validation must never make a third provider call");

  for (const [label, providerError] of [
    ["D-timeout", new ZhipuClientError("AI_TIMEOUT", "timeout", true)],
    ["E-auth", new ZhipuClientError("AI_NOT_CONFIGURED", "not configured", false)],
    ["E-quota", new ZhipuClientError("AI_PROVIDER_ERROR", "quota", false)],
  ] as const) {
    calls = 0;
    const result = await runSingleRequestGeneration({
      ...base,
      generate: async () => { calls += 1; throw providerError; },
    });
    assert.equal(result.source, "deterministic_fallback", `${label}: provider errors must resolve to fallback`);
    assert.equal(calls, 1, `${label}: provider errors must not trigger corrective retry`);
  }

  calls = 0;
  const parseFallback = await runSingleRequestGeneration({
    ...base,
    generate: async () => { calls += 1; return "not-json"; },
  });
  assert.equal(parseFallback.source, "deterministic_fallback", "F: parse failure must resolve to fallback");
  assert.equal(calls, 1, "F: parse failure must keep the existing no-retry policy");

  let lifecycleStarted = false;
  const invalidRequest = validateAIAnalysisRequest({});
  if (invalidRequest.success) lifecycleStarted = true;
  assert.equal(invalidRequest.success, false, "G: invalid incoming request must remain rejected");
  assert.equal(lifecycleStarted, false, "G: invalid incoming request must not be masked by fallback");
}

function testDeterministicFallback(): void {
  const request = narrativeFactsRequest();
  const facts = buildNarrativeFacts(request);
  const analysis = createDeterministicNarrative(facts);
  const response: AIAnalysisResponse = {
    ok: true,
    analysis,
    metadata: {
      generatedAt: "2026-08-28T00:00:00.000Z",
      inputSignature: request.inputSignature,
      provider: "zhipu",
      model: "deterministic-narrative-v1",
    },
  };
  const validation = validateAIAnalysisResponse(
    response,
    request.context.authoritativeTopPropertyId,
    request.context.candidates[0].property.name ?? undefined,
    [request.context.candidates[1].property.name!],
    false,
    {
      educationNeed: request.context.preferences.educationNeed,
      comparisons: request.context.candidateComparisons,
      topPropertyName: request.context.candidates[0].property.name ?? undefined,
      dimensions: request.context.candidates[0].decision.dimensions.map(({ key, label, score, status }) => ({ key, label, score, status })),
    },
  );

  assert.equal(validation.success, true, "Q: deterministic fallback must pass the unchanged full validator");
  assert.equal(analysis.topPropertyId, request.context.ranking[0], "Q: fallback must preserve authoritative Top1");
  assert.ok(analysis.decisionSummary.includes(request.context.candidates[1].property.name!), "A: fallback must explicitly name the authoritative alternative");
  assert.ok(analysis.decisionSummary.includes("龙湖·御湖境的通勤时间更短") && analysis.decisionSummary.includes("招商·臻园虽然更慢，但仍满足"), "I: fallback must preserve commute direction and target nuance");
  assert.ok(analysis.decisionSummary.includes("商业配套上的当前结果相当"), "H: equal commercial evidence must remain equal");
  assert.ok(/小区品质.*尚待确认/.test(analysis.decisionSummary) && /物业服务.*尚待确认/.test(analysis.decisionSummary), "K: unknown evidence must remain pending");
  assert.ok(!/教育|学校|学位|入学/.test(analysis.decisionSummary), "J: education must be absent when educationNeed is none");
  assert.ok(analysis.decisionSummary.includes("预算内") && !/市场价格合理|市场合理价|成交价更合理|成交价已经合理|价格已经得到市场验证/.test(analysis.decisionSummary), "L: budget fit must not imply market reasonableness");
  assert.ok(!/Evidence Gap|UNKNOWN|TOP1_BETTER|\bEQUAL\b|validation|retry|provider|[a-z]+_[a-z_]+/i.test(`${analysis.decisionSummary}\n${analysis.pendingEvidence.join("\n")}`), "M: fallback must not expose internal terminology");
  assert.deepEqual(facts.candidateOrder.map((item) => item.id), request.context.ranking, "Q: fallback source order must remain authoritative");
  assert.ok(!analysis.decisionSummary.includes("不存在的房源"), "Q: fallback must not invent a candidate");
  assert.ok(!/匹配度\s*\d|推荐等级|评分为/.test(analysis.decisionSummary), "Q: fallback must not invent scores or recommendations");

  const genericFacts = {
    ...facts,
    comparisonFacts: facts.comparisonFacts.map((item) => ({
      ...item,
      allowedMeaning: item.relationMeaning === "两者表现相当"
        ? "两套房在该项上的当前结果相当。"
        : item.relationMeaning === "两者表现接近"
          ? "两套房在该项上的当前结果接近。"
          : item.allowedMeaning,
    })),
  };
  const genericComparison = createDeterministicNarrative(genericFacts);
  assert.ok(genericComparison.decisionSummary.includes(request.context.candidates[1].property.name!), "B: equal/close generic comparison must still name the alternative");
  assert.ok(!/商业配套.{0,12}(?:更强|更优|领先)/.test(genericComparison.decisionSummary), "B: equal commercial evidence must not create a Top1 advantage");

  const unknownComparison = createDeterministicNarrative({ ...facts, comparisonFacts: [] });
  assert.ok(unknownComparison.decisionSummary.includes(request.context.candidates[1].property.name!), "D: unknown/no differentiator comparison must name the alternative");
  assert.ok(/信息不足|待确认/.test(unknownComparison.decisionSummary), "D: unknown comparison must remain insufficient");
}

function routeDiagnosticRequest(): AIAnalysisRequest {
  const properties = createDemoProperties();
  const preferences = createDemoBuyerPreferences();
  const engine = runDecisionEngine({ properties, preferences, asOfDate: "2026-08-28" });
  const context = projectAIAnalysisContext({ properties, preferences, engine, geoEvidenceByProperty: {}, webEvidenceByProperty: {} });
  return { schemaVersion: 2, locale: "zh-CN", inputSignature: createAIInputSignature(context), context };
}

async function callRouteWithProviderMock(
  request: AIAnalysisRequest,
  providerFetch: typeof fetch,
): Promise<{ status: number; payload: AIAnalysisResponse; calls: number }> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ZHIPU_API_KEY;
  let calls = 0;
  process.env.ZHIPU_API_KEY = "test-only-not-a-real-key";
  globalThis.fetch = (async (input, init) => {
    calls += 1;
    return providerFetch(input, init);
  }) as typeof fetch;
  try {
    const response = await analyzePost(new Request("http://localhost/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }));
    return { status: response.status, payload: await response.json() as AIAnalysisResponse, calls };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = originalKey;
  }
}

function providerResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

function assertFallbackRoute(
  result: { status: number; payload: AIAnalysisResponse; calls: number },
  expectedCalls: number,
  label: string,
  request: AIAnalysisRequest,
): void {
  assert.equal(result.status, 200, `${label}: route must return HTTP 200`);
  assert.equal(result.payload.ok, true, `${label}: response must be frontend-consumable`);
  assert.equal(result.calls, expectedCalls, `${label}: provider call count must remain bounded`);
  if (!result.payload.ok) return;
  assert.equal(result.payload.metadata.model, "deterministic-narrative-v1", `${label}: deterministic fallback must be returned`);
  assert.equal(result.payload.analysis.topPropertyId, request.context.authoritativeTopPropertyId, `${label}: Top1 must remain authoritative`);
  assert.ok(result.payload.analysis.decisionSummary.includes(request.context.candidates[1].property.name!), `${label}: alternative must be named`);
}

async function testRouteLevelFallbacks(): Promise<void> {
  const request = routeDiagnosticRequest();

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    queueMicrotask(() => typeof callback === "function" && callback());
    return 1 as unknown as NodeJS.Timeout;
  }) as unknown as typeof setTimeout;
  try {
    const timeout = await callRouteWithProviderMock(request, async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    assertFallbackRoute(timeout, 1, "G-timeout", request);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  const auth = await callRouteWithProviderMock(request, async () => ({ ok: false, status: 401 } as Response));
  assertFallbackRoute(auth, 1, "H-auth", request);

  const quota = await callRouteWithProviderMock(request, async () => ({ ok: false, status: 429 } as Response));
  assertFallbackRoute(quota, 1, "I-quota", request);

  const parse = await callRouteWithProviderMock(request, async () => providerResponse("not-json"));
  assertFallbackRoute(parse, 1, "J-parse", request);

  const invalidModelOutput = JSON.stringify({
    topPropertyId: request.context.authoritativeTopPropertyId,
    topPropertyName: request.context.candidates[0].property.name,
    decisionSummary: `与${request.context.candidates[1].property.name}相比，当前存在 Evidence Gap。`,
    pendingEvidence: ["核实物业服务"],
    disclaimer: "本解读基于当前信息。",
  });
  const exhausted = await callRouteWithProviderMock(request, async () => providerResponse(invalidModelOutput));
  assertFallbackRoute(exhausted, 2, "K-validation-exhausted", request);
}

const comparisons = {
  primaryAlternativeId: "property-b",
  primaryAlternativeName: "乙房",
  dimensions: [
    { dimensionKey: "commercial_amenities", label: "商业配套", relation: "EQUAL", top1Score: 100, top2Score: 100 },
    { dimensionKey: "community_quality", label: "小区品质", relation: "UNKNOWN", top1Score: null, top2Score: null },
  ],
  commute: {
    relation: "TOP1_WORSE_BUT_WITHIN_TARGET",
    top1PrimaryMinutes: 40,
    top1PartnerMinutes: null,
    top2PrimaryMinutes: 30,
    top2PartnerMinutes: null,
    primaryIdealMinutes: 35,
    primaryMaxMinutes: 60,
    partnerIdealMinutes: null,
    partnerMaxMinutes: null,
    top1TargetStatus: "WITHIN_MAX",
  },
  budgetMatch: {
    relation: "CLOSE",
    maximumBudget: 350,
    top1ExpectedTransactionPrice: 300,
    top2ExpectedTransactionPrice: 305,
    top1BudgetMargin: 50,
    top2BudgetMargin: 45,
  },
  buildingArea: {
    relation: "EQUAL",
    top1SquareMeters: 100,
    top2SquareMeters: 100,
  },
} satisfies AICandidateComparisonFacts;

function validateNarrative(summary: string, educationNeed: "none" | "current" = "current") {
  const response: AIAnalysisResponse = {
    ok: true,
    analysis: {
      topPropertyId: "property-a",
      topPropertyName: "甲房",
      decisionSummary: summary,
      pendingEvidence: ["核实物业服务"],
      disclaimer: "本解读基于当前信息。",
    },
    metadata: {
      generatedAt: "2026-08-28T00:00:00.000Z",
      inputSignature: "test-signature",
      provider: "zhipu",
      model: "test-model",
    },
  };
  const consistency: AINarrativeConsistencyConstraint = {
    educationNeed,
    comparisons,
    topPropertyName: "甲房",
    dimensions: [
      { key: "commercial_amenities", label: "商业配套", score: 100, status: "known" },
      { key: "community_quality", label: "小区品质", score: null, status: "unknown" },
      { key: "education", label: "教育", score: null, status: "unknown" },
    ],
  };
  return validateAIAnalysisResponse(response, "property-a", "甲房", ["乙房"], false, consistency);
}

function testNarrativeSafety(): void {
  const equalInvalid = validateNarrative("相比乙房，甲房商业配套更强。乙房通勤更短，甲房仍在最大可接受范围。当前仍需确认物业服务。下一步核实物业服务。", "current");
  assert.equal(equalInvalid.success, false, "H: equal commercial evidence must reject a superiority claim");
  const equalCorrected = validateNarrative("相比乙房，双方商业配套相当。乙房通勤更短，甲房仍在最大可接受范围。当前仍需确认物业服务。下一步核实物业服务。", "current");
  assert.equal(equalCorrected.success, true, "H: corrected equal comparison must pass");

  const commuteInvalid = validateNarrative("相比乙房，甲房通勤更快，商业配套相当。当前仍需确认物业服务。下一步核实物业服务。", "current");
  assert.equal(commuteInvalid.success, false, "I: reversed commute direction must fail");
  const commuteCorrected = validateNarrative("相比乙房，乙房通勤更短；甲房本人约40分钟，高于理想值但仍在最大可接受范围，双方商业配套相当。当前仍需确认物业服务。下一步核实物业服务。", "current");
  assert.equal(commuteCorrected.success, true, "I: truthful commute correction must pass");

  const educationInvalid = validateNarrative("相比乙房，乙房通勤更短，双方商业配套相当。甲房教育资源更有优势。当前仍需确认物业服务。下一步核实物业服务。", "none");
  assert.equal(educationInvalid.success, false, "J: education must be omitted when educationNeed is none");
  const educationCorrected = validateNarrative("相比乙房，乙房通勤更短；甲房仍在最大可接受范围，双方商业配套相当。当前仍需确认物业服务。下一步核实物业服务。", "none");
  assert.equal(educationCorrected.success, true, "J: removing education comparison must pass");

  const unknownInvalid = validateNarrative("相比乙房，乙房通勤更短，双方商业配套相当，但甲房小区品质更强。当前仍需确认物业服务。下一步核实物业服务。", "current");
  assert.equal(unknownInvalid.success, false, "K: unknown dimension must not become a confirmed advantage");
  const unknownCorrected = validateNarrative("相比乙房，乙房通勤更短，双方商业配套相当；当前小区品质尚无法判断。下一步核实物业服务。", "current");
  assert.equal(unknownCorrected.success, true, "K: unknown dimension may be described as pending confirmation");

  const internalLanguage = validateNarrative("相比乙房，两套房通勤接近。当前存在 Evidence Gap。下一步核实物业服务。", "current");
  assert.equal(internalLanguage.success, false, "J: internal Narrative Facts terminology must be rejected");
}

function validResponse(inputSignature = "dedupe-signature"): Extract<AIAnalysisResponse, { ok: true }> {
  return {
    ok: true,
    analysis: {
      topPropertyId: "property-a",
      topPropertyName: "甲房",
      decisionSummary: "当前甲房更适合继续验证。",
      pendingEvidence: ["核实物业服务"],
      disclaimer: "本解读基于当前信息。",
    },
    metadata: {
      generatedAt: "2026-08-28T00:00:00.000Z",
      inputSignature,
      provider: "zhipu",
      model: "test-model",
    },
  };
}

async function testClientReliability(): Promise<void> {
  const request = {
    inputSignature: "dedupe-signature",
    context: {
      authoritativeTopPropertyId: "property-a",
      candidates: [{ property: { name: "甲房" }, geoEvidence: null }],
    },
  } as AIAnalysisRequest;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let releaseFetch!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFetch = resolve; });
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    await gate;
    return { json: async () => validResponse() } as Response;
  }) as typeof fetch;

  try {
    const first = requestAIAnalysis(request);
    const second = requestAIAnalysis(request);
    assert.strictEqual(first, second, "P: same-signature requests must share one active promise");
    releaseFetch();
    await Promise.all([first, second]);
    assert.equal(fetchCalls, 1, "P: double click must produce one fetch");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(shouldApplyAIAnalysisResponse({
    aborted: false,
    generation: 1,
    currentGeneration: 2,
    response: validResponse("old-signature"),
    inputSignature: "new-signature",
    topPropertyId: "property-a",
  }), false, "Q: a late stale response must not be applied");
  assert.equal(shouldApplyAIAnalysisResponse({
    aborted: false,
    generation: 2,
    currentGeneration: 2,
    response: validResponse("new-signature"),
    inputSignature: "new-signature",
    topPropertyId: "property-a",
  }), true, "Q: only the current matching response may be applied");

  const values = new Map<string, string>();
  const localStorage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  } satisfies Storage;
  const browserGlobal = globalThis as unknown as Record<string, unknown>;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
    writable: true,
  });
  try {
    assert.equal(saveAIAnalysisRecord({
      propertyId: "property-a",
      inputSignature: "old-signature",
      engineVersion: "engine-test",
      generatedAt: "2026-08-27T00:00:00.000Z",
      analysis: validResponse("old-signature").analysis,
    }), true);
    assert.equal(findLatestAIAnalysisForProperty("property-a")?.inputSignature, "old-signature", "O: latest failure path can retain the previous valid record");
  } finally {
    delete browserGlobal.window;
  }
}

async function testNarrativeTemperature(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ZHIPU_API_KEY;
  let requestTemperature: unknown;
  process.env.ZHIPU_API_KEY = "test-only-not-a-real-key";
  globalThis.fetch = (async (_input, init) => {
    requestTemperature = JSON.parse(String(init?.body)).temperature as unknown;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    } as Response;
  }) as typeof fetch;
  try {
    await generateAIAnalysis("test prompt", { temperature: AI_NARRATIVE_TEMPERATURE });
    assert.equal(requestTemperature, 0.1, "Narrative generation must use temperature 0.1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = originalKey;
  }
}

async function main(): Promise<void> {
  testNarrativeFactsBuilder();
  await testRetryControlFlow();
  await testSingleClickLifecycle();
  testDeterministicFallback();
  await testRouteLevelFallbacks();
  testNarrativeSafety();
  await testClientReliability();
  await testNarrativeTemperature();
  console.info("AI single-click orchestration scenarios A-Q: PASS");
}

void main();
