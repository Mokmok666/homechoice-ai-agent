import type {
  DimensionWebEvidence,
  NormalizedWebSearchResult,
  TransactionEvidenceKind,
  WebEvidenceConfidence,
  WebEvidenceDimensionKey,
  WebEvidenceFact,
} from "./types";

const MEDIUM_DOMAINS = ["ke.com", "fang.com", "anjuke.com", "58.com", "leju.com", "jiwu.com", "thepaper.cn", "caixin.com", "yicai.com"];
const LOW_SOURCE_PATTERN = /论坛|贴吧|问答|个人博客|自媒体|业主群|匿名/i;

function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export function canonicalSourceDomain(domain: string | undefined): string | undefined {
  if (!domain) return undefined;
  const normalized = domain.replace(/^www\./, "").toLowerCase();
  return MEDIUM_DOMAINS.find((candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`)) ?? normalized;
}

export function sourceCredibility(result: NormalizedWebSearchResult): WebEvidenceConfidence {
  if (result.credibilityHint) return result.credibilityHint;
  const domain = canonicalSourceDomain(result.sourceDomain ?? domainFromUrl(result.url)) ?? "";
  if (domain.endsWith(".gov.cn") || domain.endsWith(".edu.cn")) return "high";
  if (LOW_SOURCE_PATTERN.test(`${result.title} ${result.snippet ?? ""}`)) return "low";
  if (MEDIUM_DOMAINS.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) return "medium";
  return "low";
}

export function classifyTransactionEvidence(text: string): TransactionEvidenceKind {
  const normalized = text.replace(/\s+/g, " ");
  if (/挂牌|在售|报价|售价|待售/.test(normalized) && !/成交|网签/.test(normalized)) return "listing";
  if (/成交|网签/.test(normalized)) return "transaction";
  return "unknown";
}

function toFact(result: NormalizedWebSearchResult, dimensionKey: WebEvidenceDimensionKey): WebEvidenceFact | null {
  const title = result.title.trim();
  const claim = (result.snippet?.trim() || title).slice(0, 280);
  if (!title || !claim || !/^https?:\/\//i.test(result.url)) return null;
  const sourceDomain = canonicalSourceDomain(result.sourceDomain ?? domainFromUrl(result.url));
  return {
    claim,
    sourceTitle: title,
    sourceUrl: result.url,
    ...(sourceDomain ? { sourceDomain } : {}),
    ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
    fetchedAt: result.fetchedAt,
    confidence: sourceCredibility(result),
    ...(dimensionKey === "transaction_price_reasonableness" || dimensionKey === "liquidity"
      ? { transactionKind: classifyTransactionEvidence(`${title} ${claim}`) }
      : {}),
  };
}

function evidenceStatus(facts: WebEvidenceFact[]): DimensionWebEvidence["status"] {
  if (facts.length === 0) return "unavailable";
  const distinctMediumSources = new Set(
    facts.filter((fact) => fact.confidence === "medium").map((fact) => fact.sourceDomain ?? fact.sourceUrl),
  );
  if (facts.some((fact) => fact.confidence === "high") || distinctMediumSources.size >= 2) return "verified";
  return "partial";
}

export function buildDimensionWebEvidenceSummary(
  dimensionKey: WebEvidenceDimensionKey,
  status: DimensionWebEvidence["status"],
  facts: WebEvidenceFact[],
): string {
  if (status === "unavailable" || facts.length === 0) return "当前缺少足够公开证据，暂不判断。";
  const verified = status === "verified";
  const transactionKinds = new Set(facts.map((fact) => fact.transactionKind).filter(Boolean));
  switch (dimensionKey) {
    case "location_maturity":
      return verified
        ? "公开资料可确认片区存在配套、交通或规划信息，具体成熟度仍需结合来源时效与实地情况判断。"
        : "现有公开资料提供了部分片区配套或规划线索，但证据仍有限，地段成熟度仅可初步判断。";
    case "community_quality":
      return verified
        ? "公开资料可确认项目开发或交付等基础信息，但真实居住体验仍需实地核验。"
        : "现有公开资料仅提供部分项目基础信息，尚不足以对小区品质作强判断。";
    case "property_management":
      return verified
        ? "公开资料可确认物业公司或服务相关信息，但真实服务质量仍需结合住户体验核验。"
        : "现有公开资料提供了物业相关线索，但缺少稳定服务评价，暂不对物业品质作强判断。";
    case "transaction_price_reasonableness":
      return transactionKinds.has("transaction")
        ? "现有公开资料包含成交相关线索，但尚不能替代已确认成交样本，暂不据此判断价格合理性。"
        : "现有公开资料主要为挂牌或二手房信息，缺少已确认成交样本，暂不判断成交价合理性。";
    case "liquidity":
      return verified
        ? "公开资料可确认存在二手挂牌或成交相关信息，但样本时效有限，流动性仍需持续成交验证。"
        : "现有公开资料提供了部分挂牌或成交线索，但样本有限，只能初步判断市场流通情况。";
    case "value_preservation":
      return verified
        ? "公开资料可确认片区存在交通、产业或规划支撑线索，长期价值仍取决于规划兑现与供需变化。"
        : "现有公开资料提供了部分区域发展线索，但长期保值仍缺少持续市场证据支持。";
  }
}

export function normalizeDimensionWebEvidence(
  dimensionKey: WebEvidenceDimensionKey,
  results: NormalizedWebSearchResult[],
): DimensionWebEvidence {
  const seen = new Set<string>();
  const facts = results.flatMap((result) => {
    const key = `${result.url}::${result.title}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const fact = toFact(result, dimensionKey);
    return fact ? [fact] : [];
  }).slice(0, 6);
  const status = evidenceStatus(facts);
  return {
    dimensionKey,
    status,
    summary: buildDimensionWebEvidenceSummary(dimensionKey, status, facts),
    facts,
  };
}
