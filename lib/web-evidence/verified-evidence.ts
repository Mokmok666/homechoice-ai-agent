import type {
  EvidenceKind,
  EvidenceSourceTier,
  EvidenceVerificationStatus,
  VerifiedEvidenceItem,
  VerifiedEvidenceSource,
  WebEvidenceConfidence,
  WebEvidenceDimensionKey,
  WebEvidenceFact,
} from "./types";

interface ExtractedCandidate {
  key: string;
  value: string | number;
  normalizedValue: string | number;
  unit?: string;
  evidenceKind: EvidenceKind;
  fact: WebEvidenceFact;
}

const STRUCTURAL_PATTERNS: Partial<Record<WebEvidenceDimensionKey, Array<{
  key: string;
  pattern: RegExp;
  unit?: string;
  evidenceKind: EvidenceKind;
  normalize: (match: RegExpMatchArray) => string | number;
}>>> = {
  community_quality: [
    { key: "floor_area_ratio", pattern: /容积率(?:约|为|是|[:：])?\s*(\d+(?:\.\d+)?)/, evidenceKind: "scoreable", normalize: (match) => Number(match[1]) },
    { key: "greening_ratio", pattern: /绿化率(?:约|为|是|[:：])?\s*(\d+(?:\.\d+)?)\s*%/, unit: "%", evidenceKind: "scoreable", normalize: (match) => Number(match[1]) },
    { key: "household_count", pattern: /(?:总户数|规划户数|共计?)\s*(\d+)\s*户/, unit: "户", evidenceKind: "scoreable", normalize: (match) => Number(match[1]) },
    { key: "building_count", pattern: /(?:共|规划|包含)?\s*(\d+)\s*栋(?:住宅|楼|建筑)?/, unit: "栋", evidenceKind: "scoreable", normalize: (match) => Number(match[1]) },
  ],
  property_management: [
    { key: "property_fee", pattern: /物业费(?:约|为|是|标准|[:：])?\s*(\d+(?:\.\d+)?)\s*元/, unit: "元/㎡/月", evidenceKind: "contextual", normalize: (match) => Number(match[1]) },
    { key: "property_company", pattern: /(?:物业公司|物业管理公司|物业服务企业)(?:为|是|[:：])?\s*([^，。；;\s]{2,30})/, evidenceKind: "contextual", normalize: (match) => match[1].trim() },
  ],
  building_age: [
    { key: "completion_year", pattern: /((?:19|20)\d{2})\s*年(?:竣工|建成|交付|交房)/, unit: "年", evidenceKind: "scoreable", normalize: (match) => Number(match[1]) },
    { key: "completion_year", pattern: /(?:竣工|建成|交付|交房)(?:时间|年份|日期)?(?:约|为|是|[:：])?\s*((?:19|20)\d{2})\s*年?/, unit: "年", evidenceKind: "scoreable", normalize: (match) => Number(match[1]) },
  ],
  layout_design: [
    { key: "elevator_unit_ratio", pattern: /(\d+)\s*梯\s*(\d+)\s*户/, evidenceKind: "contextual", normalize: (match) => `${Number(match[1])}梯${Number(match[2])}户` },
  ],
  liquidity: [
    { key: "listing_supply", pattern: /(\d+)\s*套(?:二手房)?(?:挂牌|在售)/, unit: "套", evidenceKind: "contextual", normalize: (match) => Number(match[1]) },
    { key: "transaction_activity", pattern: /(\d+)\s*套(?:房源)?(?:成交|网签)/, unit: "套", evidenceKind: "contextual", normalize: (match) => Number(match[1]) },
  ],
};

function sourceTier(fact: WebEvidenceFact): EvidenceSourceTier {
  const domain = fact.sourceDomain ?? "";
  if (fact.confidence === "high" || domain.endsWith(".gov.cn") || domain.endsWith(".edu.cn")) return "A";
  if (fact.confidence === "medium") return "B";
  if (/论坛|贴吧|问答|个人博客|自媒体|匿名/.test(`${fact.sourceTitle} ${fact.claim}`)) return "D";
  return "C";
}

function source(fact: WebEvidenceFact): VerifiedEvidenceSource {
  return {
    sourceType: "web",
    sourceTitle: fact.sourceTitle,
    sourceUrl: fact.sourceUrl,
    ...(fact.sourceDomain ? { sourceDomain: fact.sourceDomain } : {}),
    ...(fact.publishedAt ? { sourceDate: fact.publishedAt } : {}),
    retrievedAt: fact.fetchedAt,
    tier: sourceTier(fact),
  };
}

function confidenceFor(status: EvidenceVerificationStatus, sources: VerifiedEvidenceSource[]): WebEvidenceConfidence {
  if (status === "verified" && sources.some((item) => item.tier === "A")) return "high";
  if (status === "verified" || status === "partially_verified") return "medium";
  return "low";
}

function supportStatus(sources: VerifiedEvidenceSource[]): EvidenceVerificationStatus {
  const independent = new Set(sources.map((item) => item.sourceDomain ?? item.sourceUrl));
  if (sources.some((item) => item.tier === "A")) return "verified";
  if (independent.size >= 2 && sources.filter((item) => item.tier === "B").length >= 2) return "verified";
  if (sources.some((item) => item.tier === "B")) return "partially_verified";
  return "insufficient";
}

function candidateKey(candidate: ExtractedCandidate): string {
  return `${candidate.key}:${String(candidate.normalizedValue).toLowerCase()}`;
}

function extractCandidates(dimension: WebEvidenceDimensionKey, facts: WebEvidenceFact[]): ExtractedCandidate[] {
  const patterns = STRUCTURAL_PATTERNS[dimension] ?? [];
  const candidates: ExtractedCandidate[] = [];
  for (const fact of facts) {
    for (const definition of patterns) {
      const match = fact.claim.match(definition.pattern);
      if (!match) continue;
      const normalizedValue = definition.normalize(match);
      if (typeof normalizedValue === "number" && !Number.isFinite(normalizedValue)) continue;
      candidates.push({
        key: definition.key,
        value: normalizedValue,
        normalizedValue,
        ...(definition.unit ? { unit: definition.unit } : {}),
        evidenceKind: definition.evidenceKind,
        fact,
      });
    }
    const contextualKey = dimension === "transaction_price_reasonableness"
      ? fact.transactionKind === "transaction" ? "transaction_evidence" : fact.transactionKind === "listing" ? "listing_evidence" : "market_context"
      : `${dimension}_context`;
    candidates.push({
      key: contextualKey,
      value: fact.claim,
      normalizedValue: fact.claim.normalize("NFKC").replace(/\s+/g, " ").trim(),
      evidenceKind: "contextual",
      fact,
    });
  }
  return candidates;
}

export function buildVerifiedEvidenceItems(
  propertyId: string,
  dimension: WebEvidenceDimensionKey,
  facts: WebEvidenceFact[],
): VerifiedEvidenceItem[] {
  const groups = new Map<string, ExtractedCandidate[]>();
  for (const candidate of extractCandidates(dimension, facts)) {
    const key = candidateKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const groupedByFactKey = new Map<string, Array<{ candidate: ExtractedCandidate; sources: VerifiedEvidenceSource[]; status: EvidenceVerificationStatus }>>();
  for (const candidates of groups.values()) {
    const first = candidates[0];
    const sources = [...new Map(candidates.map((candidate) => {
      const item = source(candidate.fact);
      return [item.sourceUrl, item] as const;
    })).values()];
    const group = { candidate: first, sources, status: supportStatus(sources) };
    groupedByFactKey.set(first.key, [...(groupedByFactKey.get(first.key) ?? []), group]);
  }
  const items: VerifiedEvidenceItem[] = [];
  for (const groupsForKey of groupedByFactKey.values()) {
    const supportedValues = groupsForKey.filter((group) => group.status === "verified");
    const hasReliableConflict = new Set(supportedValues.map((group) => String(group.candidate.normalizedValue))).size > 1;
    for (const group of groupsForKey) {
      const status: EvidenceVerificationStatus = hasReliableConflict && group.status === "verified" ? "conflicting" : group.status;
      const primary = group.sources[0];
      items.push({
        propertyId,
        dimension,
        key: group.candidate.key,
        value: group.candidate.value,
        ...(group.candidate.unit ? { unit: group.candidate.unit } : {}),
        normalizedValue: group.candidate.normalizedValue,
        evidenceKind: group.candidate.evidenceKind,
        sourceType: "web",
        sourceTitle: primary?.sourceTitle,
        sourceUrl: primary?.sourceUrl,
        sourceDomain: primary?.sourceDomain,
        sourceDate: primary?.sourceDate,
        retrievedAt: primary?.retrievedAt ?? new Date(0).toISOString(),
        confidence: confidenceFor(status, group.sources),
        corroborationCount: group.sources.length,
        status,
        sources: group.sources,
      });
    }
  }
  return items;
}

export function verifiedScoreableValue(
  items: VerifiedEvidenceItem[] | undefined,
  key: string,
): string | number | undefined {
  return items?.find((item) => item.key === key && item.evidenceKind === "scoreable" && item.status === "verified")?.normalizedValue;
}

const EVIDENCE_KEY_LABELS: Record<string, string> = {
  floor_area_ratio: "容积率",
  greening_ratio: "绿化率",
  household_count: "总户数",
  building_count: "楼栋数",
  property_fee: "物业费",
  property_company: "物业公司",
  completion_year: "交付/竣工年份",
  elevator_unit_ratio: "梯户比",
  listing_supply: "挂牌供给",
  transaction_activity: "成交活动",
};

export function describeVerifiedEvidenceItem(item: VerifiedEvidenceItem): string | null {
  const label = EVIDENCE_KEY_LABELS[item.key];
  if (!label || item.status === "insufficient") return null;
  const status = item.status === "verified" ? "已验证" : item.status === "conflicting" ? "来源存在冲突" : "部分验证";
  return `${label}：${item.value}${item.unit ?? ""}（${status}，${item.corroborationCount}个独立来源）`;
}
