import { createPropertyIdentitySignature } from "@/lib/web-evidence/query-builder";
import { createWebEvidenceInterpretationSignature } from "@/lib/web-evidence/interpretation-signature";
import {
  WEB_EVIDENCE_PROVIDER_ID,
  WEB_EVIDENCE_TARGET_DIMENSIONS,
  WEB_EVIDENCE_VERSION,
  type WebEvidenceDimensionKey,
  type WebEvidenceInterpretationApiResponse,
  type WebEvidenceInterpretationRequest,
} from "@/lib/web-evidence/types";

export type WebInterpretationValidationResult<T> = { success: true; data: T } | { success: false; errors: string[] };
const FORBIDDEN_LANGUAGE = /根据模型|AI认为|我认为|综合评分|评分为|排名第一|建议购买|推荐购买|一定升值|必然升值|保证升值|稳赚|保证入学|入学有保障/i;
const DIMENSION_OVERCLAIM_LANGUAGE = /保值能力强|物业好|物业服务较好|服务良好|品质优秀/i;
const CAUTIOUS_LANGUAGE = /现有|目前|初步|仍|但|暂|有限|不足|尚|显示|资料/;
const STRONG_POSITIVE_LANGUAGE = /很好|较好|良好|优秀|成熟度高|十分成熟|流动性强|流动性好|成交活跃|保值能力强|长期价值高/;

const INSUFFICIENT_CONCLUSIONS: Record<WebEvidenceDimensionKey, string> = {
  location_maturity: "现有公开资料不足以判断该片区当前成熟度。",
  community_quality: "当前缺少足够项目级公开证据，暂无法判断小区实际品质。",
  property_management: "当前公开资料不足以判断该小区物业服务水平。",
  building_age: "当前缺少足够可信的交付或竣工年份证据，暂无法确认楼龄。",
  layout_design: "当前缺少足够户型结构证据，暂无法判断户型设计。",
  education: "当前缺少有效的官方招生范围证据，暂无法确认房源与学校的入学关系。",
  transaction_price_reasonableness: "当前缺少足够真实成交样本，暂无法判断该价格是否处于合理区间。",
  liquidity: "当前缺少足够真实成交和市场活跃度证据，暂无法判断该房源流动性。",
  value_preservation: "当前证据不足以判断该房源的长期价值稳定性。",
};

type Relevance = "DIRECT" | "PARTIAL" | "IRRELEVANT";

function classifyFact(dimensionKey: WebEvidenceDimensionKey, claim: string, transactionKind?: string): Relevance {
  const text = normalize(claim);
  switch (dimensionKey) {
    case "location_maturity":
      if (/规划|拟建|将建|计划|未来|预计开通|在建/.test(text) && !/已开业|已建成|已开通|投入使用|正式运营/.test(text)) return "IRRELEVANT";
      if (/已开业|已建成|已开通|投入使用|正式运营|现有商业|现有医疗|现有公共服务|社区商业已/.test(text)) return "DIRECT";
      return /商业|交通|医院|医疗|学校|公共服务|生活设施/.test(text) ? "PARTIAL" : "IRRELEVANT";
    case "community_quality":
      if (/高端|豪宅|标杆|匠心|品质住宅|品牌房企/.test(text) && !/交付|密度|容积率|公共空间|社区设施|园林|住户|业主/.test(text)) return "IRRELEVANT";
      if (/容积率|建筑密度|公共空间|社区设施|会所|交付质量|交付问题|住户|业主反馈|小区环境|园林/.test(text)) return "DIRECT";
      return /项目规模|占地|户数|楼栋/.test(text) ? "PARTIAL" : "IRRELEVANT";
    case "property_management":
      if (/物业类型|住宅物业|商业物业|物业为住宅|物业为商业|建筑类型|产权类型|板楼|塔楼|开发商/.test(text) && !/物业公司|物业管理|物业服务|物业费|投诉|服务记录/.test(text)) return "IRRELEVANT";
      if (/物业服务|物业费|服务范围|服务记录|投诉|业主反馈|住户反馈|物业管理质量/.test(text)) return "DIRECT";
      return /物业公司|物业管理公司|管理主体|物业为|物业：/.test(text) ? "PARTIAL" : "IRRELEVANT";
    case "building_age":
      if (/开盘|预售|拿地|施工开始|开工/.test(text) && !/交付|交房|竣工|建成/.test(text)) return "IRRELEVANT";
      return /交付|交房|竣工|建成/.test(text) && /(?:19|20)\d{2}/.test(text) ? "DIRECT" : "IRRELEVANT";
    case "layout_design":
      if (/面积|\d+㎡|\d+平/.test(text) && !/户型|朝向|阳台|梯户比|开间|进深/.test(text)) return "IRRELEVANT";
      return /户型|朝向|阳台|梯户比|开间|进深/.test(text) ? "DIRECT" : "IRRELEVANT";
    case "education":
      if (/开发商|中介|学区房|名校旁|名校附近/.test(text) && !/教育局|政府|招生范围|服务范围|划片|对口/.test(text)) return "IRRELEVANT";
      if (/教育局|政府|招生范围|服务范围|划片|对口|入学范围/.test(text)) return "DIRECT";
      return /学校|教育|学区/.test(text) ? "PARTIAL" : "IRRELEVANT";
    case "transaction_price_reasonableness":
      if (transactionKind === "listing" || /挂牌|在售|报价|售价|营销价格/.test(text) && !/成交|网签/.test(text)) return "IRRELEVANT";
      return transactionKind === "transaction" || /成交|网签/.test(text) ? "DIRECT" : "IRRELEVANT";
    case "liquidity":
      if (transactionKind === "transaction" || /成交量|成交套数|成交周期|去化周期|成交活跃|成交频率|成交趋势|网签/.test(text)) return "DIRECT";
      return transactionKind === "listing" || /挂牌|在售|二手房源|转售/.test(text) ? "PARTIAL" : "IRRELEVANT";
    case "value_preservation":
      if (/绿化率|板楼|塔楼|高层|超高层|园林|景观|高端|豪宅/.test(text) && !/已开通交通|已建成商业|产业就业|人口需求|成交活跃/.test(text)) return "IRRELEVANT";
      if (/规划|在建|拟建|未来/.test(text) && !/已开通|已建成|投入使用|正式运营/.test(text)) return "PARTIAL";
      if (/已开通|已建成|投入使用|正式运营/.test(text) && /交通|地铁|商业|公共设施/.test(text)) return "DIRECT";
      if (/产业|就业|人口|需求|供给|成交活跃|成交趋势|流动性/.test(text)) return "DIRECT";
      return "IRRELEVANT";
  }
}

function relevantFacts(dimensionKey: WebEvidenceDimensionKey, facts: WebEvidenceInterpretationRequest["evidence"]["dimensions"][number]["facts"]) {
  return facts.map((fact) => ({ fact, relevance: classifyFact(dimensionKey, fact.claim, fact.transactionKind) }))
    .filter((item) => item.relevance !== "IRRELEVANT");
}

function requiresInsufficientFallback(dimensionKey: WebEvidenceDimensionKey, relevant: ReturnType<typeof relevantFacts>): boolean {
  if (relevant.length === 0) return true;
  const directCount = relevant.filter((item) => item.relevance === "DIRECT").length;
  if (dimensionKey === "location_maturity" || dimensionKey === "community_quality" || dimensionKey === "value_preservation") return directCount === 0;
  if (dimensionKey === "education") return directCount === 0;
  if (dimensionKey === "transaction_price_reasonableness") return directCount < 3;
  if (dimensionKey === "liquidity") return directCount === 0 && relevant.length < 2;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[，。；：、“”‘’（）()【】\[\],.!?]/g, "");
}

function significantBigrams(value: string): Set<string> {
  const text = normalize(value).replace(/公开资料|现有资料|目前|可以|可确认|初步判断|仍需|缺少/g, "");
  const result = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2));
  return result;
}

function isGrounded(text: string, claims: string[]): boolean {
  const claimBigrams = new Set(claims.flatMap((claim) => [...significantBigrams(claim)]));
  return [...significantBigrams(text)].some((item) => claimBigrams.has(item));
}

function numbers(value: string): string[] {
  return value.match(/\d+(?:\.\d+)?/g) ?? [];
}

export function validateWebEvidenceInterpretationRequest(value: unknown): WebInterpretationValidationResult<WebEvidenceInterpretationRequest> {
  const errors: string[] = [];
  if (!isRecord(value) || !isRecord(value.property) || !isRecord(value.evidence) || typeof value.interpretationSignature !== "string") {
    return { success: false, errors: ["request structure is invalid"] };
  }
  const property = value.property;
  const evidence = value.evidence;
  if (!["propertyId", "name", "city", "district"].every((key) => typeof property[key] === "string" && String(property[key]).trim())) errors.push("property identity is invalid");
  if (typeof evidence.propertyId !== "string" || evidence.propertyId !== property.propertyId || typeof evidence.propertyIdentitySignature !== "string" || !Array.isArray(evidence.dimensions)) errors.push("evidence identity is invalid");
  const candidate = value as unknown as WebEvidenceInterpretationRequest;
  if (errors.length === 0) {
    if (candidate.evidence.version !== WEB_EVIDENCE_VERSION || candidate.evidence.providerId !== WEB_EVIDENCE_PROVIDER_ID) errors.push("evidence provider or version is unsupported");
    if (candidate.evidence.propertyIdentitySignature !== createPropertyIdentitySignature(candidate.property)) errors.push("property signature does not match");
    if (candidate.interpretationSignature !== createWebEvidenceInterpretationSignature(candidate.evidence)) errors.push("interpretation signature does not match");
    if (candidate.evidence.dimensions.length !== WEB_EVIDENCE_TARGET_DIMENSIONS.length || !candidate.evidence.dimensions.every((dimension) =>
      WEB_EVIDENCE_TARGET_DIMENSIONS.includes(dimension.dimensionKey)
      && ["verified", "partial", "unavailable"].includes(dimension.status)
      && Array.isArray(dimension.facts)
      && dimension.facts.every((fact) => typeof fact.claim === "string" && typeof fact.sourceTitle === "string" && /^https?:\/\//i.test(fact.sourceUrl) && ["high", "medium", "low"].includes(fact.confidence)),
    )) errors.push("evidence dimensions are invalid");
  }
  return errors.length ? { success: false, errors } : { success: true, data: candidate };
}

export function validateWebEvidenceInterpretationOutput(
  value: unknown,
  request: WebEvidenceInterpretationRequest,
): WebInterpretationValidationResult<WebEvidenceInterpretationApiResponse & { ok: true }> {
  const errors: string[] = [];
  if (!isRecord(value) || !onlyKeys(value, ["propertyId", "dimensions"]) || value.propertyId !== request.property.propertyId || !Array.isArray(value.dimensions)) {
    return { success: false, errors: ["output structure or property identity is invalid"] };
  }
  const usable = request.evidence.dimensions.filter((dimension) => dimension.status !== "unavailable" && dimension.facts.length > 0);
  const usableByKey = new Map(usable.map((dimension) => [dimension.dimensionKey, dimension]));
  const seen = new Set<WebEvidenceDimensionKey>();
  const dimensions: Array<{ dimensionKey: WebEvidenceDimensionKey; conclusion: string; supportingFacts: string[] }> = [];
  for (const item of value.dimensions) {
    if (!isRecord(item) || !onlyKeys(item, ["dimensionKey", "conclusion", "supportingFacts"]) || !WEB_EVIDENCE_TARGET_DIMENSIONS.includes(item.dimensionKey as never)) { errors.push("dimension output is invalid"); continue; }
    const dimensionKey = item.dimensionKey as WebEvidenceDimensionKey;
    const inputDimension = usableByKey.get(dimensionKey);
    if (!inputDimension || seen.has(dimensionKey)) { errors.push(`dimension ${dimensionKey} is unsupported or duplicated`); continue; }
    seen.add(dimensionKey);
    const conclusion = typeof item.conclusion === "string" ? item.conclusion.trim() : "";
    const supportingFacts = Array.isArray(item.supportingFacts) && item.supportingFacts.every((fact) => typeof fact === "string") ? item.supportingFacts.map((fact) => fact.trim()) : [];
    const relevant = relevantFacts(dimensionKey, inputDimension.facts);
    const claims = relevant.map(({ fact }) => fact.claim);
    const sourceNumbers = new Set(claims.flatMap(numbers));
    if (conclusion.length < 10 || conclusion.length > 100 || /[\r\n]/.test(conclusion) || FORBIDDEN_LANGUAGE.test(conclusion)) errors.push(`${dimensionKey} conclusion is unsafe`);
    if (supportingFacts.length > 3) errors.push(`${dimensionKey} has too many supportingFacts`);
    const mustFallback = requiresInsufficientFallback(dimensionKey, relevant);
    const weakLiquidityClaim = dimensionKey === "liquidity"
      && relevant.every((item) => item.relevance === "PARTIAL")
      && STRONG_POSITIVE_LANGUAGE.test(conclusion);
    const semanticallyInvalid = mustFallback
      || weakLiquidityClaim
      || DIMENSION_OVERCLAIM_LANGUAGE.test(conclusion)
      || !isGrounded(conclusion, claims)
      || numbers(conclusion).some((number) => !sourceNumbers.has(number))
      || (inputDimension.status === "partial" && !CAUTIOUS_LANGUAGE.test(conclusion));
    const groundedSupportingFacts = semanticallyInvalid ? [] : supportingFacts.filter((fact) =>
      fact.length >= 2
      && fact.length <= 100
      && !FORBIDDEN_LANGUAGE.test(fact)
      && !DIMENSION_OVERCLAIM_LANGUAGE.test(fact)
      && isGrounded(fact, claims)
      && numbers(fact).every((number) => sourceNumbers.has(number)),
    );
    dimensions.push({
      dimensionKey,
      conclusion: semanticallyInvalid ? INSUFFICIENT_CONCLUSIONS[dimensionKey] : conclusion,
      supportingFacts: groundedSupportingFacts,
    });
  }
  for (const inputDimension of usable) {
    if (seen.has(inputDimension.dimensionKey)) continue;
    dimensions.push({
      dimensionKey: inputDimension.dimensionKey,
      conclusion: INSUFFICIENT_CONCLUSIONS[inputDimension.dimensionKey],
      supportingFacts: [],
    });
  }
  if (errors.length) return { success: false, errors };
  return {
    success: true,
    data: {
      ok: true,
      propertyId: request.property.propertyId,
      interpretationSignature: request.interpretationSignature,
      dimensions,
      metadata: { provider: "zhipu", model: "", generatedAt: "" },
    },
  };
}
